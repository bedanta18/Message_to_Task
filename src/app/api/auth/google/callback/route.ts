import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { verify } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { saveConnection } from "@/lib/google/account";
import { getProfile } from "@/lib/google/gmail";
import { exchangeCode, revokeToken } from "@/lib/google/oauth";
import { redirectTo } from "@/lib/http";
import { track } from "@/lib/repo/events";
import { findOrCreateOwnerWorkspace } from "@/lib/repo/workspace";
import { cookieOptions, createSessionToken, OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Step 2 of Google OAuth: validate state (CSRF), exchange code (PKCE), verify the account, store encrypted tokens. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const fail = (code: string) => {
    const res = redirectTo(`/?error=${code}`);
    res.cookies.set(OAUTH_COOKIE, "", cookieOptions(0));
    return res;
  };

  if (p.get("error")) return fail(p.get("error") === "access_denied" ? "access_denied" : "oauth_failed");

  const stored = verify<{ state: string; verifier: string }>(req.cookies.get(OAUTH_COOKIE)?.value);
  const state = p.get("state");
  const code = p.get("code");
  if (!stored || !state || !safeEqual(stored.state, state)) return fail("state_mismatch");
  if (!code) return fail("oauth_failed");

  try {
    const tokens = await exchangeCode(code, stored.verifier);
    const { emailAddress } = await getProfile(tokens.access_token);
    const email = emailAddress.toLowerCase();

    if (!env.allowedEmails.includes(email)) {
      // Private tool: don't keep access to anyone else's mailbox.
      await revokeToken(tokens.refresh_token ?? tokens.access_token);
      return fail("not_allowed");
    }

    const wid = await findOrCreateOwnerWorkspace(email);
    await saveConnection(wid, email, tokens);
    await track(wid, "gmail_connected", {});

    const { token, maxAgeMs } = createSessionToken({ wid, kind: "owner", email });
    const res = redirectTo("/?connected=1");
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
    res.cookies.set(OAUTH_COOKIE, "", cookieOptions(0));
    return res;
  } catch (e) {
    console.error("[oauth] callback failed", e instanceof Error ? e.message : e);
    return fail(e instanceof AppError && e.code === "oauth_scope_missing" ? "scope_missing" : "oauth_failed");
  }
}
