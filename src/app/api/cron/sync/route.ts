import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { syncGmail } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INTERVAL: Record<string, string> = { hourly: "55 minutes", every_6_hours: "6 hours", daily: "23 hours" };

/**
 * Scheduled sync (Vercel Cron). Only syncs owner workspaces whose "Sync frequency"
 * is not manual and that are due. Tasks are still never created without approval.
 */
export async function GET(req: NextRequest) {
  const secret = env.cronSecret;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const due = await query<{ workspace_id: string; sync_frequency: string }>(
    `select s.workspace_id, s.sync_frequency from settings s
       join gmail_accounts g on g.workspace_id = s.workspace_id and g.status = 'connected'
      where s.sync_frequency <> 'manual'
        and (g.last_sync_at is null or g.last_sync_at < now() - (case s.sync_frequency
              when 'hourly' then interval '${INTERVAL.hourly}'
              when 'every_6_hours' then interval '${INTERVAL.every_6_hours}'
              else interval '${INTERVAL.daily}' end))`,
  );
  const results = [];
  for (const w of due) {
    try {
      const r = await syncGmail(w.workspace_id, { budgetMs: 45_000 });
      results.push({ workspace: w.workspace_id, new: r.new, analyzed: r.analyzed });
    } catch (e) {
      results.push({ workspace: w.workspace_id, error: toUserMessage(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
