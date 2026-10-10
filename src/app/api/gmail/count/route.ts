import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/current";
import { jsonError } from "@/lib/http";
import { estimateSyncCount } from "@/lib/sync";
import { SyncRangeSchema } from "@/lib/sync-range";

export const dynamic = "force-dynamic";

/** Count of Gmail messages in the chosen sync range (for the "All emails" option). */
export async function GET(req: NextRequest) {
  try {
    const { workspace } = await requireOwner();
    const sp = req.nextUrl.searchParams;
    const range = SyncRangeSchema.safeParse({ after: sp.get("after") ?? undefined, before: sp.get("before") ?? undefined });
    const estimate = await estimateSyncCount(workspace.id, range.success ? range.data : undefined);
    return NextResponse.json({ ok: true, estimate });
  } catch (e) {
    return jsonError(e);
  }
}
