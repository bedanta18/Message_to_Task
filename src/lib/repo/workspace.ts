import { normalizeAnalysis } from "../ai/normalize";
import { persistAnalysis } from "../analyze";
import { one, query, tx, type Db } from "../db";
import { buildDemoEmails, buildDemoManualTasks } from "../demo-data";
import { insertEmailIfNew } from "./emails";
import { getDirectory, seedDirectory } from "./teams";

export interface Workspace {
  id: string;
  kind: "owner" | "demo";
  owner_email: string | null;
  name: string;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  return one<Workspace>("select id, kind, owner_email, name from workspaces where id = $1", [id]);
}

export async function touchWorkspace(id: string): Promise<void> {
  await query("update workspaces set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '10 minutes'", [id]);
}

/** The owner's workspace is keyed by their Gmail address and starts with an empty inbox (no mock mail). */
export async function findOrCreateOwnerWorkspace(email: string): Promise<string> {
  const normalized = email.toLowerCase();
  const existing = await one<{ id: string }>("select id from workspaces where owner_email = $1", [normalized]);
  if (existing) return existing.id;
  return tx(async (d) => {
    const [w] = await d.query<{ id: string }>(
      "insert into workspaces (kind, owner_email, name) values ('owner', $1, 'Bedanta''s agency') on conflict (owner_email) do update set owner_email = excluded.owner_email returning id",
      [normalized],
    );
    await d.query("insert into settings (workspace_id) values ($1) on conflict do nothing", [w!.id]);
    const hasTeams = await d.query("select 1 from teams where workspace_id = $1 limit 1", [w!.id]);
    if (!hasTeams.length) await seedDirectory(d, w!.id);
    return w!.id;
  });
}

/** Creates an isolated, pre-populated demo workspace. Old demo workspaces are garbage-collected. */
export async function createDemoWorkspace(): Promise<string> {
  await query("delete from workspaces where kind = 'demo' and last_seen_at < now() - interval '3 days'").catch(() => {});
  return tx(async (d) => {
    const [w] = await d.query<{ id: string }>("insert into workspaces (kind, name) values ('demo', 'Demo agency') returning id");
    const wid = w!.id;
    await d.query("insert into settings (workspace_id) values ($1)", [wid]);
    await seedDirectory(d, wid);
    await seedDemoContent(d, wid);
    return wid;
  });
}

export async function seedDemoContent(d: Db, wid: string): Promise<void> {
  const threshold = 0.75;
  const now = Date.now();
  for (const demo of buildDemoEmails()) {
    const { teams, members } = await getDirectory(wid, d);
    const { id } = await insertEmailIfNew(d, wid, {
      source: "demo",
      external_id: demo.key,
      thread_id: null,
      from_name: demo.from_name,
      from_email: demo.from_email,
      to_addresses: demo.to,
      cc_addresses: demo.cc ?? null,
      subject: demo.subject,
      snippet: demo.body.slice(0, 140),
      body: demo.body,
      received_at: new Date(now - demo.hoursAgo * 3_600_000),
      labels: ["DEMO"],
      is_demo: true,
    });
    const normalized = normalizeAnalysis(demo.analysis, { subject: demo.subject, body: demo.body, from_name: demo.from_name, from_email: demo.from_email }, teams, members);
    await persistAnalysis(wid, { id }, { model: "demo (pre-computed)", raw: JSON.stringify(demo.analysis), analysis: normalized, latencyMs: null, threshold }, d);

    if (demo.approve) {
      const reqs = await d.query<{ id: string; title: string; description: string; deliverable: string | null; client: string | null; priority: string; deadline: string | null; suggested_team_id: string | null; suggested_member_id: string | null; confidence: number | null; dependencies: unknown; instructions: unknown }>(
        "select * from requirements where email_id = $1 and status = 'pending' order by idx",
        [id],
      );
      for (const r of reqs) {
        await d.query(
          `insert into tasks (workspace_id, email_id, requirement_id, title, description, deliverable, client, priority, deadline, team_id, member_id,
                              status, ai_confidence, suggested_team_id, suggested_member_id, recommendation_accepted, dependencies, instructions, is_demo)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $10, $11, true, $14::jsonb, $15::jsonb, true)`,
          [wid, id, r.id, r.title, r.description, r.deliverable, r.client, r.priority, r.deadline, r.suggested_team_id, r.suggested_member_id,
            demo.approve.status, r.confidence, JSON.stringify(r.dependencies), JSON.stringify(r.instructions)],
        );
        await d.query("update requirements set status = 'approved' where id = $1", [r.id]);
      }
      await d.query("update emails set status = 'processed' where id = $1", [id]);
    }
  }

  const { teams, members } = await getDirectory(wid, d);
  for (const m of buildDemoManualTasks()) {
    await d.query(
      `insert into tasks (workspace_id, title, description, client, priority, deadline, team_id, member_id, status, is_demo, completed_at)
       values ($1, $2, '', $3, $4, $5, $6, $7, $8, true, case when $8 = 'completed' then now() else null end)`,
      [wid, m.title, m.client, m.priority, m.deadline, teams.find((t) => t.name === m.team)?.id ?? null,
        members.find((x) => x.name === m.member)?.id ?? null, m.status],
    );
  }
}
