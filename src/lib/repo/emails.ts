import { one, query, type Db } from "../db";
import type { EmailRow, EmailStatus, RequirementRow } from "../types";

export interface NewEmail {
  source: "gmail" | "demo";
  external_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string;
  snippet: string;
  body: string;
  received_at: Date;
  labels: string[];
  is_demo?: boolean;
}

/**
 * Inserts an email unless (workspace, source, external_id) already exists.
 * This is the duplicate guard: the Gmail message ID is the idempotency key.
 */
export async function insertEmailIfNew(d: Db, workspaceId: string, e: NewEmail): Promise<{ id: string; inserted: boolean }> {
  const inserted = await d.query<{ id: string }>(
    `insert into emails (workspace_id, source, external_id, thread_id, from_name, from_email, to_addresses, cc_addresses,
                         subject, snippet, body, received_at, labels, is_demo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (workspace_id, source, external_id) do nothing
     returning id`,
    [workspaceId, e.source, e.external_id, e.thread_id, e.from_name, e.from_email, e.to_addresses, e.cc_addresses,
      e.subject, e.snippet, e.body, e.received_at, e.labels, e.is_demo ?? false],
  );
  if (inserted[0]) return { id: inserted[0].id, inserted: true };
  const existing = await d.query<{ id: string }>(
    "select id from emails where workspace_id = $1 and source = $2 and external_id = $3",
    [workspaceId, e.source, e.external_id],
  );
  return { id: existing[0]!.id, inserted: false };
}

export async function existingExternalIds(workspaceId: string, source: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await query<{ external_id: string }>(
    "select external_id from emails where workspace_id = $1 and source = $2 and external_id = any($3::text[])",
    [workspaceId, source, ids],
  );
  return new Set(rows.map((r) => r.external_id));
}

export async function getEmail(workspaceId: string, id: string): Promise<EmailRow | null> {
  if (!isUuid(id)) return null;
  return one<EmailRow>("select * from emails where id = $1 and workspace_id = $2", [id, workspaceId]);
}

export interface EmailListItem extends EmailRow {
  classification: string | null;
  confidence: number | null;
  pending_requirements: number;
  task_count: number;
}

export async function listEmails(
  workspaceId: string,
  opts: { status?: EmailStatus | "all" | "open"; q?: string; limit?: number } = {},
): Promise<EmailListItem[]> {
  const params: unknown[] = [workspaceId];
  const where = ["e.workspace_id = $1"];
  if (opts.status === "open") where.push("e.status in ('action_required', 'needs_review')");
  else if (opts.status && opts.status !== "all") {
    params.push(opts.status);
    where.push(`e.status = $${params.length}`);
  }
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const p = `$${params.length}`;
    where.push(`(e.subject ilike ${p} or e.from_name ilike ${p} or e.from_email ilike ${p}
                 or exists (select 1 from requirements r where r.email_id = e.id and (r.client ilike ${p} or r.title ilike ${p})))`);
  }
  params.push(opts.limit ?? 200);
  return query<EmailListItem>(
    `select e.*, a.classification, a.confidence,
            (select count(*)::int from requirements r where r.email_id = e.id and r.status = 'pending') as pending_requirements,
            (select count(*)::int from tasks t where t.email_id = e.id) as task_count
       from emails e
       left join lateral (
         select classification, confidence from ai_analyses x
          where x.email_id = e.id and x.error is null order by x.created_at desc limit 1
       ) a on true
      where ${where.join(" and ")}
      order by e.received_at desc
      limit $${params.length}`,
    params,
  );
}

export interface AnalysisRow {
  id: string;
  model: string;
  prompt_version: string;
  classification: string | null;
  confidence: number | null;
  output: { reason?: string; corrections?: string[]; client?: string | null } | null;
  latency_ms: number | null;
  error: string | null;
  created_at: Date;
}

export async function latestAnalysis(emailId: string): Promise<AnalysisRow | null> {
  return one<AnalysisRow>(
    "select id, model, prompt_version, classification, confidence, output, latency_ms, error, created_at from ai_analyses where email_id = $1 order by created_at desc limit 1",
    [emailId],
  );
}

export async function listRequirements(workspaceId: string, emailId: string): Promise<RequirementRow[]> {
  return query<RequirementRow>(
    `select r.*, t.name as suggested_team_name, m.name as suggested_member_name,
            (select id from tasks k where k.requirement_id = r.id) as task_id
       from requirements r
       left join teams t on t.id = r.suggested_team_id
       left join members m on m.id = r.suggested_member_id
      where r.workspace_id = $1 and r.email_id = $2
      order by r.idx`,
    [workspaceId, emailId],
  );
}

export async function setEmailStatus(workspaceId: string, id: string, status: EmailStatus, error: string | null = null): Promise<void> {
  await query("update emails set status = $3, error = $4 where id = $1 and workspace_id = $2", [id, workspaceId, status, error]);
}

export async function pendingEmailIds(workspaceId: string, limit = 50): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "select id from emails where workspace_id = $1 and status in ('pending', 'error') order by received_at desc limit $2",
    [workspaceId, limit],
  );
  return rows.map((r) => r.id);
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
