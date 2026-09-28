import { cookies } from "next/headers";
import { sign, verify } from "./crypto";
import { BASE_PATH, env } from "./env";

/**
 * The app has no passwords. The owner "signs in" by connecting their Gmail via
 * Google OAuth; visitors get an isolated demo workspace. Either way the browser
 * only holds a signed, httpOnly cookie that names the workspace.
 */
export type Session = { wid: string; kind: "owner" | "demo"; email?: string; exp: number };

export const SESSION_COOKIE = "aah_session";
export const OAUTH_COOKIE = "aah_oauth";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax" as const,
    path: BASE_PATH,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export function createSessionToken(s: Omit<Session, "exp">, ttlMs = THIRTY_DAYS): { token: string; maxAgeMs: number } {
  return { token: sign({ ...s, exp: Date.now() + ttlMs }), maxAgeMs: ttlMs };
}

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  return verify<Session>(store.get(SESSION_COOKIE)?.value);
}
