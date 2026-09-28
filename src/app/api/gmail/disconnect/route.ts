import type { NextRequest } from "next/server";
import { requireOwner } from "@/lib/current";
import { disconnect } from "@/lib/google/account";
import { assertSameOrigin, jsonError, redirectTo } from "@/lib/http";
import { track } from "@/lib/repo/events";

export const dynamic = "force-dynamic";

/** Revokes the Google grant and deletes the stored (encrypted) tokens. Synced emails and tasks are kept. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { workspace } = await requireOwner();
    await disconnect(workspace.id);
    await track(workspace.id, "gmail_disconnected", {});
    return redirectTo("/settings?disconnected=1");
  } catch (e) {
    return jsonError(e);
  }
}
