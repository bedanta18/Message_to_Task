import { z } from "zod";
import { one, query, tx } from "../db";
import { todayIso, addDaysIso, isValidIsoDate } from "../dates";
import { AppError } from "../errors";
import { PRIORITIES, TASK_STATUSES, type TaskRow, type TaskStatus } from "../types";
import { isUuid } from "./emails";
import { getSettings } from "./settings";
import { track } from "./events";

const TASK_SELECT = `
  select k.*, t.name as team_name, m.name as member_name, e.subject as email_subject
    from tasks k
    left join teams t on t.id = k.team_id
    left join members m on m.id = k.member_id
    left join emails e on e.id = k.email_id`;

const optionalId = z.string().trim().optional().transform((v) => (v && isUuid(v) ? v : null));
const optionalDate = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  if (!isValidIsoDate(v)) {
    ctx.addIssue({ code: "custom", message: "Deadline must be a valid date" });
    return z.NEVER;
  }
  return v;
});
const lines = z.string().optional().transform((v) => (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 15));

export const TaskInput = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(160),
  description: z.string().trim().max(4000).default(""),
  deliverable: z.string().trim().max(300).optional().transform((v) => v || null),
  client: z.string().trim().max(160).optional().transform((v) => v || null),
  priority: z.enum(PRIORITIES),
  deadline: optionalDate,
  team_id: optionalId,
  member_id: optionalId,
  dependencies: lines,
  instructions: lines,
});
export type TaskInputT = z.infer<typeof TaskInput>;

async function assertDirectory(workspaceId: string, teamId: string | null, memberId: string | null) {
  if (teamId && !(await one("select 1 from teams where id = $1 and workspace_id = $2", [teamId, workspaceId]))) {
    throw new AppError("bad_team", "That team no longer exists.");
  }
  if (memberId && !(await one("select 1 from members where id = $1 and workspace_id = $2", [memberId, workspaceId]))) {
    throw new AppError("bad_member", "That team member no longer exists.");
  }
}

/**
 * Human approval step: turns an AI requirement draft (possibly edited) into a task.
 * requirement_id is UNIQUE on tasks, so approving twice can never create two tasks.
 */
export async function createTaskFromRequirement(workspaceId: string, requirementId: string, input: TaskInputT, requestedStatus?: TaskStatus): Promise<string> {
  await assertDirectory(workspaceId, input.team_id, input.member_id);
  const settings = await getSettings(workspaceId);
  const result = await tx(async (d) => {
    const [req] = await d.query<{ id: string; email_id: string; status: string; confidence: number | null; suggested_team_id: string | null; suggested_member_id: string | null; is_demo: boolean }>(
      `select r.id, r.email_id, r.status, r.confidence, r.suggested_team_id, r.suggested_member_id, e.is_demo
         from requirements r join emails e on e.id = r.email_id
        where r.id = $1 and r.workspace_id = $2 for update of r`,
      [requirementId, workspaceId],
    );
    if (!req) throw new AppError("not_found", "This task suggestion no longer exists.", { status: 404 });
    if (req.status !== "pending") throw new AppError("duplicate", "A task has already been created (or ignored) for this suggestion.", { status: 409 });

    const hadSuggestion = Boolean(req.suggested_team_id || req.suggested_member_id);
    const accepted = hadSuggestion ? req.suggested_team_id === input.team_id && req.suggested_member_id === input.member_id : null;
    const status: TaskStatus = requestedStatus ?? (input.member_id && settings.default_status === "assigned" ? "assigned" : "new");

    const [task] = await d.query<{ id: string }>(
      `insert into tasks (workspace_id, email_id, requirement_id, title, description, deliverable, client, priority, deadline,
                          team_id, member_id, status, ai_confidence, suggested_team_id, suggested_member_id,
                          recommendation_accepted, dependencies, instructions, is_demo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19)
       returning id`,
      [workspaceId, req.email_id, req.id, input.title, input.description, input.deliverable, input.client, input.priority,
        input.deadline, input.team_id, input.member_id, status, req.confidence, req.suggested_team_id, req.suggested_member_id,
        accepted, JSON.stringify(input.dependencies), JSON.stringify(input.instructions), req.is_demo],
    );
    await d.query("update requirements set status = 'approved' where id = $1", [req.id]);
    await refreshEmailStatus(d, workspaceId, req.email_id);
    return { taskId: task!.id, accepted, assigned: Boolean(input.member_id) };
  });

  await track(workspaceId, "task_created", { from: "ai_suggestion" });
  if (result.assigned) await track(workspaceId, "task_assigned", {});
  if (result.accepted === true) await track(workspaceId, "ai_recommendation_accepted", {});
  if (result.accepted === false) await track(workspaceId, "ai_recommendation_rejected", {});
  return result.taskId;
}

/** Manual task creation, e.g. from a Needs Review email with no usable AI draft. */
export async function createManualTask(workspaceId: string, emailId: string | null, input: TaskInputT): Promise<string> {
  await assertDirectory(workspaceId, input.team_id, input.member_id);
  const id = await tx(async (d) => {
    let isDemo = false;
    if (emailId) {
      const [e] = await d.query<{ is_demo: boolean }>("select is_demo from emails where id = $1 and workspace_id = $2", [emailId, workspaceId]);
      if (!e) throw new AppError("not_found", "Email not found.", { status: 404 });
      isDemo = e.is_demo;
    }
    const [task] = await d.query<{ id: string }>(
      `insert into tasks (workspace_id, email_id, title, description, deliverable, client, priority, deadline, team_id, member_id,
                          status, dependencies, instructions, is_demo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new', $11::jsonb, $12::jsonb, $13) returning id`,
      [workspaceId, emailId, input.title, input.description, input.deliverable, input.client, input.priority, input.deadline,
        input.team_id, input.member_id, JSON.stringify(input.dependencies), JSON.stringify(input.instructions), isDemo],
    );
    if (emailId) {
      await d.query("update requirements set status = 'ignored' where email_id = $1 and status = 'pending'", [emailId]);
      await d.query("update emails set status = 'processed' where id = $1", [emailId]);
    }
    return task!.id;
  });
  await track(workspaceId, "task_created", { from: "manual" });
  if (input.member_id) await track(workspaceId, "task_assigned", {});
  return id;
}

/** After a requirement is approved/ignored: email becomes processed once nothing is pending. */
async function refreshEmailStatus(d: { query: typeof query }, workspaceId: string, emailId: string) {
  const [c] = await d.query<{ pending: number; approved: number }>(
    `select count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status = 'approved')::int as approved
       from requirements where email_id = $1`,
    [emailId],
  );
  if (c && c.pending === 0) {
    await d.query("update emails set status = $3 where id = $1 and workspace_id = $2", [emailId, workspaceId, c.approved > 0 ? "processed" : "ignored"]);
  }
}

export async function ignoreRequirement(workspaceId: string, requirementId: string): Promise<void> {
  await tx(async (d) => {
    const [r] = await d.query<{ email_id: string }>(
      "update requirements set status = 'ignored' where id = $1 and workspace_id = $2 and status = 'pending' returning email_id",
      [requirementId, workspaceId],
    );
    if (r) await refreshEmailStatus(d, workspaceId, r.email_id);
  });
}

export async function ignoreEmail(workspaceId: string, emailId: string): Promise<void> {
  await tx(async (d) => {
    await d.query("update requirements set status = 'ignored' where email_id = $1 and workspace_id = $2 and status = 'pending'", [emailId, workspaceId]);
    await d.query("update emails set status = 'ignored' where id = $1 and workspace_id = $2 and status <> 'processed'", [emailId, workspaceId]);
  });
  await track(workspaceId, "email_ignored", {});
}

export async function getTask(workspaceId: string, id: string): Promise<TaskRow | null> {
  if (!isUuid(id)) return null;
  return one<TaskRow>(`${TASK_SELECT} where k.id = $1 and k.workspace_id = $2`, [id, workspaceId]);
}

export async function updateTask(workspaceId: string, id: string, input: TaskInputT): Promise<void> {
  await assertDirectory(workspaceId, input.team_id, input.member_id);
  const before = await getTask(workspaceId, id);
  if (!before) throw new AppError("not_found", "Task not found.", { status: 404 });
  await query(
    `update tasks set title = $3, description = $4, deliverable = $5, client = $6, priority = $7, deadline = $8,
            team_id = $9, member_id = $10, dependencies = $11::jsonb, instructions = $12::jsonb, updated_at = now(),
            status = case when $10::uuid is not null and status = 'new' and $10::uuid is distinct from member_id then 'assigned' else status end
      where id = $1 and workspace_id = $2`,
    [id, workspaceId, input.title, input.description, input.deliverable, input.client, input.priority, input.deadline,
      input.team_id, input.member_id, JSON.stringify(input.dependencies), JSON.stringify(input.instructions)],
  );
  if (input.member_id && input.member_id !== before.member_id) await track(workspaceId, "task_assigned", {});
}

export async function assignTask(workspaceId: string, id: string, teamId: string | null, memberId: string | null): Promise<void> {
  await assertDirectory(workspaceId, teamId, memberId);
  const before = await getTask(workspaceId, id);
  if (!before) throw new AppError("not_found", "Task not found.", { status: 404 });
  await query(
    `update tasks set team_id = $3, member_id = $4, updated_at = now(),
            status = case when $4::uuid is not null and status = 'new' then 'assigned' else status end
      where id = $1 and workspace_id = $2`,
    [id, workspaceId, teamId, memberId],
  );
  if (memberId && memberId !== before.member_id) await track(workspaceId, "task_assigned", {});
}

export async function setTaskStatus(workspaceId: string, id: string, status: TaskStatus): Promise<void> {
  if (!TASK_STATUSES.includes(status)) throw new AppError("bad_status", "Unknown status.");
  const rows = await query<{ id: string }>(
    `update tasks set status = $3, updated_at = now(),
            completed_at = case when $3 = 'completed' then coalesce(completed_at, now()) else null end
      where id = $1 and workspace_id = $2 returning id`,
    [id, workspaceId, status],
  );
  if (!rows.length) throw new AppError("not_found", "Task not found.", { status: 404 });
  if (status === "completed") await track(workspaceId, "task_completed", {});
}

export async function deleteTask(workspaceId: string, id: string): Promise<void> {
  await query("delete from tasks where id = $1 and workspace_id = $2", [id, workspaceId]);
}

export interface TaskFilters {
  q?: string;
  status?: string; // a TaskStatus, "open", or "all"
  team?: string;
  member?: string; // uuid or "unassigned"
  priority?: string;
  due?: string; // today | week | overdue | none
}

export async function listTasks(workspaceId: string, f: TaskFilters = {}): Promise<TaskRow[]> {
  const params: unknown[] = [workspaceId];
  const where = ["k.workspace_id = $1"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  const today = todayIso();

  if (f.q?.trim()) {
    params.push(`%${f.q.trim()}%`);
    const p = `$${params.length}`;
    where.push(`(k.title ilike ${p} or k.client ilike ${p} or k.description ilike ${p} or e.subject ilike ${p} or m.name ilike ${p})`);
  }
  if (f.status === "open" || !f.status) where.push("k.status not in ('completed', 'cancelled')");
  else if (f.status !== "all" && (TASK_STATUSES as readonly string[]).includes(f.status)) add("k.status = ?", f.status);
  if (f.team && isUuid(f.team)) add("k.team_id = ?", f.team);
  if (f.member === "unassigned") where.push("k.member_id is null");
  else if (f.member && isUuid(f.member)) add("k.member_id = ?", f.member);
  if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority)) add("k.priority = ?", f.priority);
  if (f.due === "today") add("k.deadline = ?::date", today);
  else if (f.due === "week") {
    add("k.deadline >= ?::date", today);
    add("k.deadline <= ?::date", addDaysIso(today, 7));
  } else if (f.due === "overdue") {
    add("k.deadline < ?::date", today);
    where.push("k.status not in ('completed', 'cancelled')");
  } else if (f.due === "none") where.push("k.deadline is null");

  return query<TaskRow>(
    `${TASK_SELECT} where ${where.join(" and ")}
      order by case k.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               k.deadline asc nulls last, k.created_at desc
      limit 500`,
    params,
  );
}

export interface DashboardMetrics {
  emails_synced: number;
  emails_today: number;
  action_required: number;
  needs_review: number;
  unassigned: number;
  due_today: number;
  overdue: number;
  completed: number;
  open_tasks: number;
}

export async function dashboardMetrics(workspaceId: string): Promise<DashboardMetrics> {
  const today = todayIso();
  const [m] = await query<DashboardMetrics>(
    `select
       (select count(*)::int from emails where workspace_id = $1) as emails_synced,
       (select count(*)::int from emails where workspace_id = $1 and created_at >= now() - interval '1 day') as emails_today,
       (select count(*)::int from emails where workspace_id = $1 and status = 'action_required') as action_required,
       (select count(*)::int from emails where workspace_id = $1 and status = 'needs_review') as needs_review,
       (select count(*)::int from tasks where workspace_id = $1 and member_id is null and status not in ('completed', 'cancelled')) as unassigned,
       (select count(*)::int from tasks where workspace_id = $1 and deadline = $2::date and status not in ('completed', 'cancelled')) as due_today,
       (select count(*)::int from tasks where workspace_id = $1 and deadline < $2::date and status not in ('completed', 'cancelled')) as overdue,
       (select count(*)::int from tasks where workspace_id = $1 and status = 'completed') as completed,
       (select count(*)::int from tasks where workspace_id = $1 and status not in ('completed', 'cancelled')) as open_tasks`,
    [workspaceId, today],
  );
  return m!;
}

/** Early AI-quality signals; the base for a future evaluation dashboard. */
export async function aiQualitySignals(workspaceId: string) {
  const [r] = await query<{ decided: number; accepted: number; analyses: number; avg_conf: number | null; failures: number; ignored_drafts: number; approved_drafts: number }>(
    `select
       (select count(*)::int from tasks where workspace_id = $1 and recommendation_accepted is not null) as decided,
       (select count(*)::int from tasks where workspace_id = $1 and recommendation_accepted) as accepted,
       (select count(*)::int from ai_analyses where workspace_id = $1 and error is null) as analyses,
       (select avg(confidence)::float from ai_analyses where workspace_id = $1 and error is null) as avg_conf,
       (select count(*)::int from ai_analyses where workspace_id = $1 and error is not null) as failures,
       (select count(*)::int from requirements where workspace_id = $1 and status = 'ignored') as ignored_drafts,
       (select count(*)::int from requirements where workspace_id = $1 and status = 'approved') as approved_drafts`,
    [workspaceId],
  );
  return r!;
}
