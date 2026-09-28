import { NextResponse, type NextRequest } from "next/server";
import { env } from "./env";
import { AppError, toUserMessage } from "./errors";

/** Absolute URL inside the app (works behind the aipmbedanta.com rewrite). */
export function appUrl(path = "/"): URL {
  return new URL(`${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`);
}

export function redirectTo(path: string, status = 303): NextResponse {
  return NextResponse.redirect(appUrl(path), status);
}

/** Rejects cross-site POSTs (defence in depth on top of SameSite=Lax cookies). */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / curl
  const allowed = new Set([new URL(env.appUrl).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("bad_origin", "Request blocked: invalid origin.", { status: 403 });
}

export function jsonError(e: unknown): NextResponse {
  const status = e instanceof AppError ? e.status : 500;
  if (!(e instanceof AppError)) console.error(e);
  return NextResponse.json({ ok: false, code: e instanceof AppError ? e.code : "internal", error: toUserMessage(e) }, { status });
}
