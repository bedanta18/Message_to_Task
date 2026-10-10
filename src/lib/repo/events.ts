import { query } from "../db";

/**
 * First-party product analytics. Props must only hold ids, counts and enums —
 * never subjects, bodies, addresses or any other email content.
 */
export type EventName =
  | "gmail_connected"
  | "gmail_disconnected"
  | "email_synced"
  | "email_classified"
  | "requirement_created"
  | "task_created"
  | "task_assigned"
  | "ai_recommendation_accepted"
  | "ai_recommendation_rejected"
  | "task_completed"
  | "email_ignored"
  | "email_restored_for_review"
  | "sync_reset";

type Props = Record<string, string | number | boolean | null>;

export async function track(workspaceId: string | null, name: EventName, props: Props = {}): Promise<void> {
  try {
    await query("insert into events (workspace_id, name, props) values ($1, $2, $3::jsonb)", [workspaceId, name, JSON.stringify(props)]);
  } catch (e) {
    // Analytics must never break the product flow.
    console.error("[analytics] failed to record event", name, e instanceof Error ? e.message : e);
  }
}

export async function eventCounts(workspaceId: string): Promise<Record<string, number>> {
  const rows = await query<{ name: string; n: number }>(
    "select name, count(*)::int as n from events where workspace_id = $1 group by name",
    [workspaceId],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}
