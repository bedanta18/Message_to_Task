import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";
import { one, query } from "@/lib/db";
import { getAccount, getValidAccessToken, saveConnection } from "@/lib/google/account";
import { buildAuthUrl, GMAIL_SCOPE, refreshAccessToken } from "@/lib/google/oauth";
import { OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/session";
import { GET as callback } from "@/app/api/auth/google/callback/route";
import { json, mockFetch, ownerWorkspace } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("token encryption + signed cookies", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encrypt("1//refresh-token");
    expect(enc).not.toContain("refresh-token");
    expect(decrypt(enc)).toBe("1//refresh-token");
  });
  it("rejects tampered ciphertext", () => {
    const enc = encrypt("secret");
    const parts = enc.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("rejects tampered or expired signed tokens", () => {
    const token = sign({ a: 1, exp: Date.now() + 1000 });
    expect(verify<{ a: number }>(token)?.a).toBe(1);
    expect(verify(token.slice(0, -2) + "xx")).toBeNull();
    expect(verify(sign({ a: 1, exp: Date.now() - 1 }))).toBeNull();
  });
});

describe("OAuth consent URL", () => {
  it("requests only gmail.readonly, offline access, state and PKCE", () => {
    const { url, state, verifier } = buildAuthUrl("bedanta.product@gmail.com");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(u.searchParams.get("scope")).not.toMatch(/send|modify|compose|mail\.google\.com/);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).not.toBe(verifier);
    expect(u.searchParams.get("redirect_uri")).toBe(process.env.GOOGLE_REDIRECT_URI);
  });
});

function callbackRequest(params: Record<string, string>, cookie?: string) {
  const url = new URL("http://localhost:3000/tools/agency-action-hub/api/auth/google/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {} });
}
const oauthCookie = (state: string) => sign({ state, verifier: "verifier-123", exp: Date.now() + 60_000 });

describe("OAuth callback", () => {
  it("rejects a mismatched state (CSRF)", async () => {
    const res = await callback(callbackRequest({ code: "c", state: "evil" }, oauthCookie("good")));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
  });

  it("handles the user denying permission", async () => {
    const res = await callback(callbackRequest({ error: "access_denied", state: "s" }, oauthCookie("s")));
    expect(res.headers.get("location")).toContain("error=access_denied");
  });

  it("refuses accounts that are not allowed, and revokes the grant", async () => {
    const { calls } = mockFetch({
      "https://oauth2.googleapis.com/token": () => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GMAIL_SCOPE, token_type: "Bearer" }),
      "https://gmail.googleapis.com/gmail/v1/users/me/profile": () => json({ emailAddress: "stranger@gmail.com" }),
      "https://oauth2.googleapis.com/revoke": () => new Response("", { status: 200 }),
    });
    const res = await callback(callbackRequest({ code: "c", state: "s" }, oauthCookie("s")));
    expect(res.headers.get("location")).toContain("error=not_allowed");
    expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(await one("select 1 from workspaces where owner_email = 'stranger@gmail.com'")).toBeNull();
  });

  it("rejects a grant without the Gmail scope", async () => {
    mockFetch({ "https://oauth2.googleapis.com/token": () => json({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }) });
    const res = await callback(callbackRequest({ code: "c", state: "s" }, oauthCookie("s")));
    expect(res.headers.get("location")).toContain("error=scope_missing");
  });

  it("connects the owner: stores encrypted tokens, sets session, returns to dashboard", async () => {
    const { calls } = mockFetch({
      "https://oauth2.googleapis.com/token": () => json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: GMAIL_SCOPE, token_type: "Bearer" }),
      "https://gmail.googleapis.com/gmail/v1/users/me/profile": () => json({ emailAddress: "Bedanta.Product@gmail.com" }),
    });
    const res = await callback(callbackRequest({ code: "auth-code", state: "s" }, oauthCookie("s")));
    expect(res.headers.get("location")).toBe("http://localhost:3000/tools/agency-action-hub?connected=1");
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
    expect(res.cookies.get(SESSION_COOKIE)?.httpOnly).toBe(true);

    const tokenCall = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))!;
    const body = new URLSearchParams(String(tokenCall.init?.body));
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-123");

    const row = await one<{ workspace_id: string; refresh_token_enc: string; access_token_enc: string }>(
      "select g.* from gmail_accounts g join workspaces w on w.id = g.workspace_id where w.owner_email = 'bedanta.product@gmail.com'",
    );
    expect(row).toBeTruthy();
    expect(row!.refresh_token_enc).not.toContain("refresh-1");
    expect(decrypt(row!.refresh_token_enc)).toBe("refresh-1");
    expect((await getAccount(row!.workspace_id))?.status).toBe("connected");
  });
});

describe("token refresh", () => {
  it("refreshes an expired access token with the stored refresh token", async () => {
    const wid = await ownerWorkspace("refresh-test@gmail.com");
    await saveConnection(wid, "refresh-test@gmail.com", { access_token: "old", refresh_token: "rt-9", expires_in: 3600, scope: GMAIL_SCOPE, token_type: "Bearer" });
    await query("update gmail_accounts set access_token_expires_at = now() - interval '1 minute' where workspace_id = $1", [wid]);

    const { calls } = mockFetch({ "https://oauth2.googleapis.com/token": () => json({ access_token: "new-access", expires_in: 3599 }) });
    expect(await getValidAccessToken(wid)).toBe("new-access");
    expect(new URLSearchParams(String(calls[0]!.init?.body)).get("refresh_token")).toBe("rt-9");
    // Cached now: no second refresh.
    expect(await getValidAccessToken(wid)).toBe("new-access");
    expect(calls).toHaveLength(1);
  });

  it("marks the account expired when Google rejects the refresh token", async () => {
    const wid = await ownerWorkspace("revoked@gmail.com");
    await saveConnection(wid, "revoked@gmail.com", { access_token: "old", refresh_token: "rt", expires_in: 0, scope: GMAIL_SCOPE, token_type: "Bearer" });
    mockFetch({ "https://oauth2.googleapis.com/token": () => json({ error: "invalid_grant" }, 400) });
    await expect(getValidAccessToken(wid)).rejects.toMatchObject({ code: "gmail_expired", userMessage: "Gmail connection expired. Please reconnect your account." });
    expect((await getAccount(wid))?.status).toBe("expired");
  });

  it("surfaces Google outages as unavailable (not expired)", async () => {
    mockFetch({ "https://oauth2.googleapis.com/token": () => json({ error: "backend_error" }, 503) });
    await expect(refreshAccessToken("rt")).rejects.toMatchObject({ code: "gmail_unavailable" });
  });
});
