import type { NextRequest } from "next/server";
import { assertSameOrigin, jsonError, redirectTo } from "@/lib/http";
import { cookieOptions, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Ends the browser session (does not revoke Gmail access — use Disconnect for that). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const res = redirectTo("/");
    res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    return res;
  } catch (e) {
    return jsonError(e);
  }
}
