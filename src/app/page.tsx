import Link from "next/link";
import { ignoreEmailAction, resetSyncAction } from "./actions";
import { ConfirmButton } from "@/components/AutoSubmit";
import { SyncButton } from "@/components/SyncButton";
import { ConnectGmailButton, Confidence, DemoBadge, DueBadge, Empty, PriorityBadge, TaskStatusBadge } from "@/components/ui";
import { getCurrent } from "@/lib/current";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { daysInQuery } from "@/lib/google/gmail";
import { BASE_PATH } from "@/lib/base-path";
import { param, type SearchParams } from "@/lib/page";
import { listEmails } from "@/lib/repo/emails";
import { getSettings } from "@/lib/repo/settings";
import { dashboardMetrics, listTasks } from "@/lib/repo/tasks";

const ERRORS: Record<string, string> = {
  access_denied: "Gmail access was not granted. You can try again whenever you’re ready — the app only asks for read-only access.",
  state_mismatch: "The sign-in link expired or was opened in a different browser. Please click “Connect Gmail” again.",
  oauth_failed: "Google sign-in could not be completed. Please try connecting again.",
  scope_missing: "Gmail read access was not granted. Please tick “View your email messages and settings” on the Google consent screen.",
  not_allowed: "This tool is private to its owner, so that Google account can’t be connected. You can still explore the full demo.",
  google_not_configured: "Google OAuth isn’t configured on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). You can explore the demo meanwhile.",
};

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const current = await getCurrent();
  const error = param(sp, "error");
  if (!current) return <Welcome error={error ? (ERRORS[error] ?? ERRORS.oauth_failed) : undefined} />;

  const wid = current.workspace.id;
  const [m, actionEmails, reviewEmails, queue, overdue, settings] = await Promise.all([
    dashboardMetrics(wid),
    listEmails(wid, { status: "action_required", limit: 6 }),
    listEmails(wid, { status: "needs_review", limit: 6 }),
    listTasks(wid, { status: "open" }),
    listTasks(wid, { due: "overdue" }),
    getSettings(wid),
  ]);
  const connected = current.gmail?.status === "connected";
  const threshold = settings.confidence_threshold;

  return (
    <>
      {param(sp, "reset") && <div className="alert alert-success" style={{ marginBottom: 16 }}>Dashboard reset. Synced emails and the tasks created from them were removed — click “Sync Emails” to start fresh.</div>}
      {param(sp, "connected") && <div className="alert alert-success" style={{ marginBottom: 16 }}>Gmail connected with read-only access. Click “Sync Emails” to fetch recent client emails.</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{ERRORS[error] ?? ERRORS.oauth_failed}</div>}

      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {current.isDemo
              ? "Demo workspace — synthetic client emails, already analysed by AI."
              : connected
                ? current.gmail?.last_sync_at ? `Last synced ${formatDateTime(current.gmail.last_sync_at)}.` : "Connected. Run your first sync."
                : "Connect Gmail to start turning client emails into tasks."}
          </p>
        </div>
        <div className="row">
          {!current.isDemo && (m.emails_synced > 0 || current.gmail?.last_sync_at) && (
            <form action={resetSyncAction}>
              <ConfirmButton
                type="submit" className="btn btn-danger"
                message="Reset the dashboard? This deletes all synced emails, their AI analyses and requirements, and every task created from an email. Your Gmail connection, settings, teams and manually created tasks are kept. This can't be undone."
              >
                Reset
              </ConfirmButton>
            </form>
          )}
          {!current.isDemo && connected && m.emails_synced > 0 && <SyncButton mode="analyze" className="btn" />}
          {!current.isDemo && (connected ? <SyncButton defaultDays={daysInQuery(settings.gmail_query) ?? 7} defaultMax={settings.max_emails} /> : <ConnectGmailButton label={current.gmail ? "Reconnect Gmail" : "Connect Gmail"} />)}
          {current.isDemo && <Link className="btn btn-primary" href="/inbox">Review inbox</Link>}
        </div>
      </div>

      {!current.isDemo && connected && !env.aiConfigured && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>AI is not configured on the server (OPENAI_API_KEY). Emails will sync but stay “pending” until it is set.</div>
      )}

      <section className="metrics" aria-label="Key metrics">
        <Link href="/inbox?tab=all" className="card metric"><span className="metric-label">Emails synced</span><span className="metric-value">{m.emails_synced}</span><span className="metric-sub">{m.emails_today} in the last 24h</span></Link>
        <Link href="/inbox?tab=action_required" className="card metric"><span className="metric-label">Action required</span><span className="metric-value" style={{ color: m.action_required ? "var(--a1)" : undefined }}>{m.action_required}</span><span className="metric-sub">{m.needs_review} need review</span></Link>
        <Link href="/tasks?member=unassigned" className={`card metric ${m.unassigned ? "warn" : ""}`}><span className="metric-label">Unassigned</span><span className="metric-value">{m.unassigned}</span><span className="metric-sub">open tasks without owner</span></Link>
        <Link href="/tasks?due=today" className={`card metric ${m.due_today ? "warn" : ""}`}><span className="metric-label">Due today</span><span className="metric-value">{m.due_today}</span><span className="metric-sub">open tasks</span></Link>
        <Link href="/tasks?due=overdue" className={`card metric ${m.overdue ? "bad" : ""}`}><span className="metric-label">Overdue</span><span className="metric-value">{m.overdue}</span><span className="metric-sub">past deadline</span></Link>
        <Link href="/tasks?status=completed" className="card metric"><span className="metric-label">Completed</span><span className="metric-value">{m.completed}</span><span className="metric-sub">{m.open_tasks} still open</span></Link>
      </section>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <section className="card">
          <div className="card-head"><h2>Action Required</h2><Link className="small" href="/inbox?tab=action_required">View all →</Link></div>
          <div className="list">
            {actionEmails.length === 0 ? (
              <Empty>{m.emails_synced ? "Nothing waiting. Every actionable email has been handled." : "No emails yet. Sync Gmail to see client requirements here."}</Empty>
            ) : actionEmails.map((e) => (
              <Link key={e.id} href={`/inbox/${e.id}`} className="list-item">
                <div className="grow">
                  <div className="list-title truncate">{e.subject}</div>
                  <div className="list-meta">
                    {e.is_demo && <DemoBadge />}
                    <span>{e.from_name ?? e.from_email}</span>
                    <span>· {formatDateTime(e.received_at)}</span>
                    <span>· {e.pending_requirements} task{e.pending_requirements === 1 ? "" : "s"} suggested</span>
                  </div>
                </div>
                <Confidence value={e.confidence} />
              </Link>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Needs Review</h2><span className="sub">Low-confidence — never turned into tasks automatically</span></div>
          <div className="list">
            {reviewEmails.length === 0 ? <Empty>No low-confidence emails.</Empty> : reviewEmails.map((e) => (
              <div key={e.id} className="list-item">
                <div className="grow">
                  <Link href={`/inbox/${e.id}`} className="list-title truncate" style={{ color: "var(--tx1)", display: "block" }}>{e.subject}</Link>
                  <div className="list-meta">{e.is_demo && <DemoBadge />}<span>{e.from_name ?? e.from_email}</span></div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {e.classification === "NO_ACTION"
                      ? `AI thinks this needs no action, but is only ${Math.round((e.confidence ?? 0) * 100)}% confident.`
                      : `AI is only ${Math.round((e.confidence ?? 0) * 100)}% confident that this email requires action.`}
                  </div>
                </div>
                <div className="row">
                  <Link className="btn btn-sm" href={`/inbox/${e.id}`}>Review</Link>
                  <form action={ignoreEmailAction}>
                    <input type="hidden" name="email_id" value={e.id} />
                    <button className="btn btn-sm btn-ghost">Ignore</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Task Queue</h2><Link className="small" href="/tasks">All tasks →</Link></div>
          <TaskList tasks={queue.slice(0, 8)} empty="No open tasks. Approve an AI suggestion to create one." />
        </section>
        <section className="card">
          <div className="card-head"><h2>Overdue</h2><Link className="small" href="/tasks?due=overdue">View →</Link></div>
          <TaskList tasks={overdue.slice(0, 8)} empty="Nothing overdue. 🎉" />
        </section>
      </div>
      <p className="faint small" style={{ marginTop: 16 }}>Emails below {Math.round(threshold * 100)}% confidence (configurable in Settings) go to Needs Review.</p>
    </>
  );
}

function TaskList({ tasks, empty }: { tasks: Awaited<ReturnType<typeof listTasks>>; empty: string }) {
  if (!tasks.length) return <Empty>{empty}</Empty>;
  return (
    <div className="list">
      {tasks.map((t) => (
        <Link key={t.id} href={`/tasks/${t.id}`} className="list-item">
          <div className="grow">
            <div className="list-title truncate">{t.title}</div>
            <div className="list-meta">
              {t.is_demo && <DemoBadge />}
              <span>{t.client ?? "No client"}</span>
              <span>· {t.member_name ?? <em>Unassigned</em>}{t.team_name ? ` (${t.team_name})` : ""}</span>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <PriorityBadge priority={t.priority} />
            <DueBadge deadline={t.deadline} />
            <TaskStatusBadge status={t.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function Welcome({ error }: { error?: string }) {
  return (
    <div className="welcome">
      <div className="row"><span className="brand-mark">A</span><span className="strong">Agency Action Hub</span><span className="faint small">· a micro-tool by Bedanta Gogoi</span></div>
      <h1>Turn client emails into <span className="grad-text">actionable tasks.</span></h1>
      <p className="muted" style={{ fontSize: 16 }}>
        Client requirements arrive every day by email. Agency Action Hub reads your inbox (read-only), spots the emails that need work,
        drafts structured tasks, and recommends who should own them. You stay in control: nothing becomes a task until you approve it.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="row">
        <ConnectGmailButton size="btn-lg" />
        <form action={`${BASE_PATH}/api/demo`} method="post">
          <button className="btn btn-lg">Explore the demo</button>
        </form>
      </div>
      <p className="faint small">
        Uses Google OAuth with the <code>gmail.readonly</code> scope only — no password, no sending, no deleting. Connecting is limited to the tool’s owner; everyone else can explore the demo.
      </p>
      <div className="flow">
        <div className="card"><div className="k">1 · Detect</div><p className="small muted">AI classifies each email: Action Required, No Action, or Uncertain.</p></div>
        <div className="card"><div className="k">2 · Extract & recommend</div><p className="small muted">Task title, client, deliverable, deadline, priority — plus the best team and person.</p></div>
        <div className="card"><div className="k">3 · You approve</div><p className="small muted">Edit, accept or change the assignment, then track it from New to Completed.</p></div>
      </div>
    </div>
  );
}
