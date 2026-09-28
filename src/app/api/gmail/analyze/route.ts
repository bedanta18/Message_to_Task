import { NextResponse, type NextRequest } from "next/server";
import { analyzeEmail } from "@/lib/analyze";
import { requireOwner } from "@/lib/current";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { analyzePending } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Analyse all pending/failed emails, or re-analyse one (body: { emailId }). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { workspace } = await requireOwner();
    const body = (await req.json().catch(() => ({}))) as { emailId?: string };
    if (body.emailId) {
      const result = await analyzeEmail(workspace.id, body.emailId);
      return NextResponse.json({ ok: result.status !== "error", result, error: result.error });
    }
    const result = await analyzePending(workspace.id, { budgetMs: 50_000 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return jsonError(e);
  }
}
