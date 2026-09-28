import { createHash } from "node:crypto";
import { randomToken } from "../crypto";
import { env, requireEnv } from "../env";
import { AppError, GmailErrors } from "../errors";

/** Least privilege: read-only Gmail. No send / modify / delete scopes. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface OAuthStart {
  url: string;
  state: string;
  verifier: string;
}

/** Builds the consent URL with CSRF `state` and PKCE (S256). */
export function buildAuthUrl(loginHint?: string): OAuthStart {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // guarantees a refresh token is issued on reconnect
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return { url: `${AUTH_URL}?${params}`, state, verifier };
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

async function postToken(body: Record<string, string>): Promise<Response> {
  try {
    return await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw GmailErrors.unavailable(e);
  }
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const res = await postToken({
    code,
    code_verifier: verifier,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: env.googleRedirectUri,
    grant_type: "authorization_code",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string };
  if (!res.ok || !data.access_token) {
    throw new AppError("oauth_exchange_failed", "Google sign-in could not be completed. Please try connecting again.", {
      status: 400, cause: new Error(data.error ?? `status ${res.status}`),
    });
  }
  const granted = (data.scope ?? "").split(" ");
  if (!granted.includes(GMAIL_SCOPE)) {
    throw new AppError("oauth_scope_missing", "Gmail read access was not granted. Please allow “View your email messages” to continue.");
  }
  return data as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await postToken({
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (res.ok && data.access_token) return { access_token: data.access_token, expires_in: data.expires_in ?? 3600 };
  if (data.error === "invalid_grant" || res.status === 400 || res.status === 401) throw GmailErrors.expired();
  throw GmailErrors.unavailable(new Error(data.error ?? `status ${res.status}`));
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
