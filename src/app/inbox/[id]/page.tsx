import Link from "next/link";
import { notFound } from "next/navigation";
import { ignoreEmailAction, restoreEmailForReviewAction, restoreRequirementForReviewAction } from "@/app/actions";
import { RequirementCard } from "@/components/RequirementCard";
import { ReanalyzeButton } from "@/components/SyncButton";
import { TaskForm } from "@/components/TaskForm";
import { ClassificationBadge, Confidence, DemoBadge, EmailStatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { pageContext } from "@/lib/page";
import { getEmail, latestAnalysis, listRequirements } from "@/lib/repo/emails";
import { getSettings } from "@/lib/repo/settings";
import { getDirectory } from "@/lib/repo/teams";
import { query } from "@/lib/db";

export const metadata = { title: "Email" };

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, isDemo } = await pageContext();
  const email = await getEmail(workspace.id, id);
  if (!email) notFound();

  const [analysis, reqs, { teams, members }, settings, linkedTasks] = await Promise.all([
    latestAnalysis(email.id),
    listRequirements(workspace.id, email.id),
    getDirectory(workspace.id),
    getSettings(workspace.id),
    query<{ id: string; title: string; status: string }>("select id, title, status from tasks where email_id = $1 and workspace_id = $2 order by created_at", [email.id, workspace.id]),
  ]);
  const pending = reqs.filter((r) => r.status === "pending");
  const restorable = reqs.filter((r) => r.status === "ignored" && !r.task_id);
  const low = email.status === "needs_review";
  const conf = analysis?.confidence != null ? Math.round(Number(analysis.confidence) * 100) : null;
  const dir = { teams: teams.map((t) => ({ id: t.id, name: t.name })), members: members.map((m) => ({ id: m.id, name: m.name, team_id: m.team_id, availability: m.availability, active_tasks: m.active_tasks })) };
  const open = email.status === "action_required" || email.status === "needs_review" || email.status === "error" || email.status === "pending";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link href="/inbox">← Inbox</Link></div>
          <h1 style={{ marginTop: 6 }}>{email.subject}</h1>
          <div className="row" style={{ marginTop: 6 }}>
            {email.is_demo && <DemoBadge />}
            <EmailStatusBadge status={email.status} />
            <span className="small faint">from {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email} · {formatDateTime(email.received_at)}</span>
          </div>
        </div>
        <div className="row">
          {!isDemo && email.status !== "processed" && <ReanalyzeButton emailId={email.id} />}
          {open && (
            <form action={ignoreEmailAction}>
              <input type="hidden" name="email_id" value={email.id} />
              <input type="hidden" name="back" value="/inbox" />
              <button className="btn btn-ghost">Ignore email</button>
            </form>
          )}
          {email.status === "ignored" && (
            <form action={restoreEmailForReviewAction}>
              <input type="hidden" name="email_id" value={email.id} />
              <button className="btn btn-primary">Put back in review</button>
            </form>
          )}
        </div>
      </div>

      <div className="grid-detail">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Original email</h2><span className="sub">{email.source === "gmail" ? "Gmail (read-only)" : "Demo"}</span></div>
            <div className="card-pad stack">
              <dl className="kv">
                <dt>From</dt><dd>{email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email ?? "Unknown"}</dd>
                <dt>To</dt><dd>{email.to_addresses || "—"}</dd>
                {email.cc_addresses && (<><dt>Cc</dt><dd>{email.cc_addresses}</dd></>)}
                <dt>Received</dt><dd>{formatDateTime(email.received_at)}</dd>
                <dt>{email.source === "gmail" ? "Gmail message ID" : "Demo ID"}</dt>
                <dd>
                  <code>{email.external_id}</code>
                  {email.source === "gmail" && <> · <a href={`https://mail.google.com/mail/u/0/#all/${email.external_id}`} target="_blank" rel="noreferrer">Open in Gmail ↗</a></>}
                </dd>
              </dl>
              <div className="email-body">{email.body || email.snippet || "(empty email body)"}</div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>AI analysis</h2>{analysis && <span className="sub">{analysis.model} · {formatDateTime(analysis.created_at)}</span>}</div>
            <div className="card-pad stack">
              {!analysis ? (
                <p className="muted">Not analysed yet.{isDemo ? "" : " Use “Re-analyse with AI” or “Analyse pending” on the dashboard."}</p>
              ) : analysis.error ? (
                <div className="alert alert-error">{email.error ?? "AI analysis failed."} The email is kept — try “Re-analyse with AI”.</div>
              ) : (
                <>
                  <div className="row"><ClassificationBadge value={analysis.classification} /><Confidence value={analysis.confidence} /></div>
                  {analysis.output?.reason && <p className="muted">{analysis.output.reason}</p>}
                  {analysis.output?.corrections && analysis.output.corrections.length > 0 && (
                    <div className="small faint">
                      <strong>Safety checks:</strong>
                      <ul className="clean">{analysis.output.corrections.map((c) => <li key={c}>{c}</li>)}</ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        <div className="stack">
          {low && (
            <div className="alert alert-warn">
              <strong>Needs Review.</strong>{" "}
              {analysis?.classification === "NO_ACTION"
                ? `AI thinks no action is needed but is only ${conf}% confident (threshold ${Math.round(settings.confidence_threshold * 100)}%).`
                : `AI is only ${conf ?? "—"}% confident that this email requires action (threshold ${Math.round(settings.confidence_threshold * 100)}%).`}{" "}
              Review the draft below, create a task manually, or ignore the email.
            </div>
          )}
          {email.status === "no_action" && <div className="alert alert-info">AI found no action in this email. If that’s wrong, create a task manually below.</div>}

          {pending.map((r, i) => (
            <RequirementCard
              key={r.id}
              req={{ ...r, confidence: r.confidence != null ? Number(r.confidence) : null }}
              teams={dir.teams}
              members={dir.members}
              lowConfidence={low}
              heading={low ? "Suggested task — needs review" : pending.length > 1 ? `Action Required · task ${i + 1} of ${pending.length}` : "Action Required"}
            />
          ))}

          {restorable.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Ignored suggestions</h2></div>
              <div className="list">
                {restorable.map((r) => (
                  <div key={r.id} className="list-item">
                    <span className="grow">{r.title}</span>
                    <form action={restoreRequirementForReviewAction}>
                      <input type="hidden" name="requirement_id" value={r.id} />
                      <button className="btn btn-sm">Put back in review</button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          )}

          {linkedTasks.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Tasks from this email</h2></div>
              <div className="list">
                {linkedTasks.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="list-item"><span className="grow strong">{t.title}</span><span className="small faint">Open →</span></Link>
                ))}
              </div>
            </section>
          )}

          {reqs.some((r) => r.status === "ignored") && pending.length === 0 && linkedTasks.length === 0 && (
            <p className="small faint">All AI suggestions for this email were ignored.</p>
          )}

          {(pending.length === 0 && email.status !== "processed") || email.status === "no_action" ? (
            <details className="card" open={low && pending.length === 0}>
              <summary className="card-head" style={{ cursor: "pointer" }}><h2>Create task manually</h2></summary>
              <div className="card-pad">
                <TaskForm
                  mode="create"
                  emailId={email.id}
                  teams={dir.teams}
                  members={dir.members}
                  initial={{ title: email.subject, client: analysis?.output?.client ?? "", description: "", deliverable: "", priority: settings.default_priority, deadline: "", team_id: "", member_id: "", dependencies: "", instructions: "" }}
                />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}
