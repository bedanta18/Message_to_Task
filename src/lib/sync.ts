import { analyzeEmail, type AnalyzeResult } from "./analyze";
import { tx } from "./db";
import { env } from "./env";
import { AiErrors, AppError, toUserMessage } from "./errors";
import { getValidAccessToken } from "./google/account";
import { buildQuery, getMessage, GmailUnauthorized, listMessageIds, parseMessage } from "./google/gmail";
import { query } from "./db";
import { existingExternalIds, insertEmailIfNew, pendingEmailIds } from "./repo/emails";
import { track } from "./repo/events";
import { getSettings } from "./repo/settings";

export interface SyncResult {
  query: string;
  found: number;
  new: number;
  duplicates: number;
  skipped: number;
  analyzed: number;
  actionRequired: number;
  needsReview: number;
  noAction: number;
  failed: number;
  remaining: number;
  errors: string[];
}

/** Runs a Gmail call, refreshing the access token once on 401. */
async function withToken<T>(workspaceId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getValidAccessToken(workspaceId);
  try {
    return await fn(token);
  } catch (e) {
    if (!(e instanceof GmailUnauthorized)) throw e;
    const refreshed = await getValidAccessToken(workspaceId, { forceRefresh: true });
    try {
      return await fn(refreshed);
    } catch (e2) {
      if (e2 instanceof GmailUnauthorized) {
        await query("update gmail_accounts set status = 'expired', last_error = 'Unauthorized after refresh' where workspace_id = $1", [workspaceId]);
        throw new AppError("gmail_expired", "Gmail connection expired. Please reconnect your account.", { status: 401 });
      }
      throw e2;
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

/**
 * Sync = fetch recent Gmail messages (read-only) → store new ones (dedupe by Gmail
 * message ID) → AI-analyse within a time budget. Anything not analysed in time
 * stays "pending" and is picked up by the next sync or "Analyse pending".
 */
export async function syncGmail(workspaceId: string, opts: { budgetMs?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const settings = await getSettings(workspaceId);
  const q = buildQuery(settings);
  const result: SyncResult = {
    query: q, found: 0, new: 0, duplicates: 0, skipped: 0, analyzed: 0, actionRequired: 0, needsReview: 0, noAction: 0, failed: 0, remaining: 0, errors: [],
  };

  try {
    const ids = await withToken(workspaceId, (t) => listMessageIds(t, q, settings.max_emails));
    result.found = ids.length;
    const known = await existingExternalIds(workspaceId, "gmail", ids);
    result.duplicates = known.size;
    const fresh = ids.filter((id) => !known.has(id));

    const account = await query<{ email: string }>("select email from gmail_accounts where workspace_id = $1", [workspaceId]);
    const self = account[0]?.email?.toLowerCase();

    await mapLimit(fresh, 5, async (id) => {
      try {
        const msg = await withToken(workspaceId, (t) => getMessage(t, id));
        const parsed = parseMessage(msg);
        if (self && parsed.from_email === self) {
          result.skipped++; // our own sent mail is never a client requirement
          return;
        }
        const ins = await tx((d) => insertEmailIfNew(d, workspaceId, parsed));
        if (ins.inserted) result.new++;
        else result.duplicates++;
      } catch (e) {
        if (e instanceof AppError && (e.code === "gmail_expired" || e.code === "gmail_rate_limited")) throw e;
        result.failed++;
        result.errors.push(`Could not read one message: ${toUserMessage(e)}`);
      }
    });

    await query("update gmail_accounts set last_sync_at = now(), last_error = null where workspace_id = $1", [workspaceId]);
    await track(workspaceId, "email_synced", { found: result.found, new: result.new, duplicates: result.duplicates });
  } catch (e) {
    await query("update gmail_accounts set last_error = $2 where workspace_id = $1", [workspaceId, toUserMessage(e)]).catch(() => {});
    throw e;
  }

  const remainingBudget = budget - (Date.now() - started);
  const a = await analyzePending(workspaceId, { budgetMs: remainingBudget });
  return { ...result, ...a, errors: [...result.errors, ...a.errors], failed: result.failed + a.failed };
}

export async function analyzePending(workspaceId: string, opts: { budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const out = { analyzed: 0, actionRequired: 0, needsReview: 0, noAction: 0, failed: 0, remaining: 0, errors: [] as string[] };
  const ids = await pendingEmailIds(workspaceId, 50);
  if (!ids.length) return out;
  if (!env.aiConfigured) {
    out.remaining = ids.length;
    out.errors.push(AiErrors.notConfigured().userMessage);
    return out;
  }

  const results: (AnalyzeResult | null)[] = await mapLimit(ids, 3, async (id) => {
    // Leave ~8s headroom for one in-flight AI call before the serverless timeout.
    if (Date.now() - started > budget - 8_000) return null;
    return analyzeEmail(workspaceId, id).catch((e) => ({ emailId: id, status: "error" as const, error: toUserMessage(e) }));
  });

  for (const r of results) {
    if (!r) out.remaining++;
    else if (r.status === "error") {
      out.failed++;
      if (r.error && !out.errors.includes(r.error)) out.errors.push(r.error);
    } else {
      out.analyzed++;
      if (r.status === "action_required") out.actionRequired++;
      else if (r.status === "needs_review") out.needsReview++;
      else if (r.status === "no_action") out.noAction++;
    }
  }
  return out;
}
