import Link from "next/link";
import { setTaskStatusAction } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { DemoBadge, DueBadge, Empty, PriorityBadge, TaskStatusBadge } from "@/components/ui";
import { pageContext, param, type SearchParams } from "@/lib/page";
import { listTasks, type TaskFilters } from "@/lib/repo/tasks";
import { getDirectory } from "@/lib/repo/teams";
import { PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type TaskRow, type TaskStatus } from "@/lib/types";

export const metadata = { title: "Tasks" };

const BOARD: TaskStatus[] = ["new", "assigned", "in_progress", "waiting_for_client", "completed"];

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace } = await pageContext();
  const sp = await searchParams;
  const view = param(sp, "view") === "board" ? "board" : "list";
  const filters: TaskFilters = {
    q: param(sp, "q"),
    status: param(sp, "status") ?? (view === "board" ? "all" : "open"),
    team: param(sp, "team"),
    member: param(sp, "member"),
    priority: param(sp, "priority"),
    due: param(sp, "due"),
  };
  const [tasks, { teams, members }] = await Promise.all([listTasks(workspace.id, filters), getDirectory(workspace.id)]);
  const qs = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), ...over })) if (v) u.set(k, v);
    return `/tasks?${u}`;
  };
  const filtered = Boolean(filters.q || filters.team || filters.member || filters.priority || filters.due || (param(sp, "status") && param(sp, "status") !== "open"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>Approved tasks, with the client email they came from.</p>
        </div>
        <div className="row">
          <Link className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`} href={qs({ view: "list" })}>List</Link>
          <Link className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} href={qs({ view: "board", status: "" })}>Board</Link>
        </div>
      </div>

      <form className="filters card card-pad" role="search">
        <input type="hidden" name="view" value={view} />
        <label className="field">Search<input type="search" name="q" defaultValue={filters.q} placeholder="Client, task, email subject, assignee…" /></label>
        <label className="field">Status
          <AutoSubmitSelect name="status" defaultValue={filters.status}>
            <option value="open">Open</option>
            <option value="all">All</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </AutoSubmitSelect>
        </label>
        <label className="field">Team
          <AutoSubmitSelect name="team" defaultValue={filters.team ?? ""}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </AutoSubmitSelect>
        </label>
        <label className="field">Assignee
          <AutoSubmitSelect name="member" defaultValue={filters.member ?? ""}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </AutoSubmitSelect>
        </label>
        <label className="field">Priority
          <AutoSubmitSelect name="priority" defaultValue={filters.priority ?? ""}>
            <option value="">Any</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}
          </AutoSubmitSelect>
        </label>
        <label className="field">Deadline
          <AutoSubmitSelect name="due" defaultValue={filters.due ?? ""}>
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
            <option value="none">No deadline</option>
          </AutoSubmitSelect>
        </label>
        <div className="row">
          <button className="btn">Apply</button>
          {filtered && <Link className="btn btn-ghost" href={`/tasks?view=${view}`}>Reset</Link>}
        </div>
      </form>

      {view === "board" ? <Board tasks={tasks} /> : <Table tasks={tasks} filtered={filtered} />}
    </>
  );
}

function StatusSelect({ t }: { t: TaskRow }) {
  return (
    <form action={setTaskStatusAction}>
      <input type="hidden" name="task_id" value={t.id} />
      <AutoSubmitSelect name="status" defaultValue={t.status} aria-label={`Status of ${t.title}`} style={{ minHeight: 28, padding: "3px 6px", fontSize: 12 }}>
        {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
      </AutoSubmitSelect>
    </form>
  );
}

function Table({ tasks, filtered }: { tasks: TaskRow[]; filtered: boolean }) {
  return (
    <section className="card">
      {tasks.length === 0 ? (
        <Empty>{filtered ? "No tasks match these filters." : "No open tasks yet. Approve an AI suggestion from the Inbox to create one."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th>Client</th><th>Assignee</th><th>Priority</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ maxWidth: 360 }}>
                    <Link href={`/tasks/${t.id}`} className="strong" style={{ color: "var(--tx1)" }}>{t.title}</Link>
                    <div className="small faint truncate">{t.is_demo && <DemoBadge />} {t.email_subject ? `✉ ${t.email_subject}` : "Created manually"}</div>
                  </td>
                  <td className="small">{t.client ?? <span className="faint">—</span>}</td>
                  <td className="small">{t.member_name ?? <span className="faint">Unassigned</span>}{t.team_name && <div className="faint">{t.team_name}</div>}</td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><DueBadge deadline={t.deadline} done={t.status === "completed" || t.status === "cancelled"} /></td>
                  <td><StatusSelect t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Board({ tasks }: { tasks: TaskRow[] }) {
  return (
    <div className="board">
      {BOARD.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <section key={s} className="column" aria-label={TASK_STATUS_LABEL[s]}>
            <div className="column-head"><span>{TASK_STATUS_LABEL[s]}</span><span>{col.length}</span></div>
            {col.map((t) => (
              <div key={t.id} className="task-card">
                <Link href={`/tasks/${t.id}`} className="title">{t.title}</Link>
                <div className="small faint">{t.client ?? "No client"} · {t.member_name ?? "Unassigned"}</div>
                <div className="row"><PriorityBadge priority={t.priority} /><DueBadge deadline={t.deadline} done={s === "completed"} />{t.is_demo && <DemoBadge />}</div>
                <StatusSelect t={t} />
              </div>
            ))}
            {col.length === 0 && <div className="small faint" style={{ padding: 6 }}>Empty</div>}
          </section>
        );
      })}
    </div>
  );
}
