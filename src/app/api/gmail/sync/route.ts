import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/current";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { MAX_SYNC_EMAILS } from "@/lib/google/gmail";
import { syncGmail } from "@/lib/sync";
import { SyncRangeSchema } from "@/lib/sync-range";

const Body = z.object({
  range: SyncRangeSchema.optional(),
  maxEmails: z.union([z.literal("all"), z.coerce.number().int().min(1).max(MAX_SYNC_EMAILS)]).optional(),
});

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Sync Emails": read recent Gmail (read-only), dedupe by message ID, AI-analyse new mail. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { workspace } = await requireOwner();
    const body = Body.safeParse(await req.json().catch(() => ({})));
    if (!body.success) throw new AppError("bad_request", `Choose a valid date range and 1–${MAX_SYNC_EMAILS} emails (or all).`, { status: 400 });
    const result = await syncGmail(workspace.id, { budgetMs: 50_000, ...body.data });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return jsonError(e);
  }
}
