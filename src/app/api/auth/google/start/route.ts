import { NextResponse } from "next/server";
import { sign } from "@/lib/crypto";
import { env } from "@/lib/env";
import { buildAuthUrl } from "@/lib/google/oauth";
import { redirectTo } from "@/lib/http";
import { cookieOptions, OAUTH_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Step 1 of Google OAuth: store state + PKCE verifier in a short-lived signed cookie, then redirect to Google. */
export async function GET() {
  if (!env.googleConfigured) return redirectTo("/?error=google_not_configured");
  const tenMinutes = 10 * 60 * 1000;
  const { url, state, verifier } = buildAuthUrl(env.allowedEmails[0]);
  const res = NextResponse.redirect(url, 302);
  res.cookies.set(OAUTH_COOKIE, sign({ state, verifier, exp: Date.now() + tenMinutes }), cookieOptions(tenMinutes));
  return res;
}
