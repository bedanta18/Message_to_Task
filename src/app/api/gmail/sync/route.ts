import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/current";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { syncGmail } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Sync Emails": read recent Gmail (read-only), dedupe by message ID, AI-analyse new mail. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { workspace } = await requireOwner();
    const result = await syncGmail(workspace.id, { budgetMs: 50_000 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return jsonError(e);
  }
}
