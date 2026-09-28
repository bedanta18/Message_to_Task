import type { NextRequest } from "next/server";
import { assertSameOrigin, jsonError, redirectTo } from "@/lib/http";
import { createDemoWorkspace } from "@/lib/repo/workspace";
import { cookieOptions, createSessionToken, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Starts an isolated demo workspace (pre-populated, clearly labelled demo data). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const wid = await createDemoWorkspace();
    const { token, maxAgeMs } = createSessionToken({ wid, kind: "demo" }, 3 * 24 * 60 * 60 * 1000);
    const res = redirectTo("/?demo=1");
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
    return res;
  } catch (e) {
    return jsonError(e);
  }
}
