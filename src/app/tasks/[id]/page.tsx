import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTaskAction, setTaskStatusAction } from "@/app/actions";
import { ConfirmButton } from "@/components/AutoSubmit";
import { TaskForm } from "@/components/TaskForm";
import { Confidence, DemoBadge, DueBadge, PriorityBadge, TaskStatusBadge } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { pageContext, param, type SearchParams } from "@/lib/page";
import { getEmail } from "@/lib/repo/emails";
import { getTask } from "@/lib/repo/tasks";
import { getDirectory } from "@/lib/repo/teams";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/types";

export const metadata = { title: "Task" };

const FLOW: TaskStatus[] = ["new", "assigned", "in_progress", "waiting_for_client", "completed"];

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspace } = await pageContext();
  const task = await getTask(workspace.id, id);
  if (!task) notFound();
  const [email, { teams, members }] = await Promise.all([
    task.email_id ? getEmail(workspace.id, task.email_id) : null,
    getDirectory(workspace.id),
  ]);
  const suggestedTeam = teams.find((t) => t.id === task.suggested_team_id)?.name;
  const suggestedMember = members.find((m) => m.id === task.suggested_member_id)?.name;
  const currentIdx = FLOW.indexOf(task.status);

  return (
    <>
      {param(sp, "created") && <div className="alert alert-success" style={{ marginBottom: 16 }}>Task created.</div>}
      <div className="page-head">
        <div>
          <div className="small"><Link href="/tasks">← Tasks</Link></div>
          <h1 style={{ marginTop: 6 }}>{task.title}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            {task.is_demo && <DemoBadge />}
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DueBadge deadline={task.deadline} done={task.status === "completed" || task.status === "cancelled"} />
            <span className="small faint">{task.client ?? "No client"} · {task.member_name ? `${task.member_name}${task.team_name ? ` — ${task.team_name}` : ""}` : task.team_name ? `${task.team_name} (no assignee)` : "Unassigned"}</span>
          </div>
        </div>
      </div>

      <section className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="spread">
          <div className="steps" role="group" aria-label="Move task">
            {FLOW.map((s, i) => (
              <form key={s} action={setTaskStatusAction}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="status" value={s} />
                <button className={`step ${s === task.status ? "current" : currentIdx > i ? "done" : ""}`} disabled={s === task.status} aria-current={s === task.status ? "step" : undefined}>
                  {currentIdx > i ? "✓ " : ""}{TASK_STATUS_LABEL[s]}
                </button>
              </form>
            ))}
          </div>
          <form action={setTaskStatusAction}>
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="status" value={task.status === "cancelled" ? "new" : "cancelled"} />
            <button className="btn btn-sm btn-ghost">{task.status === "cancelled" ? "Reopen" : "Cancel task"}</button>
          </form>
        </div>
        {task.completed_at && <p className="small faint" style={{ marginTop: 8 }}>Completed {formatDateTime(task.completed_at)}</p>}
      </section>

      <div className="grid-detail">
        <section className="card">
          <div className="card-head"><h2>Task details</h2><span className="sub">Updated {formatDateTime(task.updated_at)}</span></div>
          <div className="card-pad">
            <TaskForm
              mode="edit"
              taskId={task.id}
              teams={teams.map((t) => ({ id: t.id, name: t.name }))}
              members={members.map((m) => ({ id: m.id, name: m.name, team_id: m.team_id, availability: m.availability, active_tasks: m.active_tasks }))}
              initial={{
                title: task.title, client: task.client ?? "", description: task.description, deliverable: task.deliverable ?? "",
                priority: task.priority, deadline: task.deadline ?? "", team_id: task.team_id ?? "", member_id: task.member_id ?? "",
                dependencies: (task.dependencies ?? []).join("\n"), instructions: (task.instructions ?? []).join("\n"),
              }}
            />
            <div className="divider" style={{ margin: "18px 0 12px" }} />
            <form action={deleteTaskAction}>
              <input type="hidden" name="task_id" value={task.id} />
              <ConfirmButton className="btn btn-sm btn-danger btn-ghost" message="Delete this task? The source email is kept.">Delete task</ConfirmButton>
            </form>
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>AI</h2></div>
            <div className="card-pad">
              <dl className="kv">
                <dt>AI confidence</dt><dd>{task.ai_confidence != null ? <Confidence value={task.ai_confidence} /> : <span className="faint">Created manually</span>}</dd>
                <dt>Recommended</dt><dd>{suggestedTeam || suggestedMember ? `${suggestedMember ?? "—"}${suggestedTeam ? ` — ${suggestedTeam}` : ""}` : <span className="faint">No recommendation</span>}</dd>
                <dt>Recommendation</dt>
                <dd>{task.recommendation_accepted === true ? <span className="badge tone-green">Accepted</span> : task.recommendation_accepted === false ? <span className="badge tone-amber">Changed by you</span> : <span className="faint">—</span>}</dd>
                <dt>Created</dt><dd>{formatDateTime(task.created_at)}</dd>
                <dt>Deadline</dt><dd>{formatDate(task.deadline)}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Original email</h2>{email && <Link className="small" href={`/inbox/${email.id}`}>Open in Inbox →</Link>}</div>
            <div className="card-pad stack">
              {!email ? (
                <p className="muted">This task wasn’t created from an email.</p>
              ) : (
                <>
                  <dl className="kv">
                    <dt>Subject</dt><dd className="strong">{email.subject}</dd>
                    <dt>Sender</dt><dd>{email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}</dd>
                    <dt>Received</dt><dd>{formatDateTime(email.received_at)}</dd>
                    <dt>{email.source === "gmail" ? "Gmail message ID" : "Demo ID"}</dt><dd><code>{email.external_id}</code></dd>
                  </dl>
                  <div className="email-body">{email.body || email.snippet}</div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
