import Link from "next/link";
import { Fragment } from "react";
import { SettingsForm } from "@/components/DirectoryForms";
import { ConfirmButton } from "@/components/AutoSubmit";
import { ConnectGmailButton, DemoBadge } from "@/components/ui";
import { BASE_PATH } from "@/lib/base-path";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { buildQuery } from "@/lib/google/gmail";
import { GMAIL_SCOPE } from "@/lib/google/oauth";
import { pageContext, param, type SearchParams } from "@/lib/page";
import { eventCounts } from "@/lib/repo/events";
import { effectiveModel, getSettings } from "@/lib/repo/settings";
import { aiQualitySignals } from "@/lib/repo/tasks";
import { PRIORITIES } from "@/lib/types";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace, gmail, isDemo } = await pageContext();
  const sp = await searchParams;
  const [s, q, events] = await Promise.all([getSettings(workspace.id), aiQualitySignals(workspace.id), eventCounts(workspace.id)]);
  const acceptance = q.decided ? Math.round((q.accepted / q.decided) * 100) : null;

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Gmail, AI and task defaults for this workspace.</p></div></div>
      {param(sp, "disconnected") && <div className="alert alert-success" style={{ marginBottom: 16 }}>Gmail disconnected and Google access revoked. Synced emails and tasks were kept.</div>}

      <div className="grid-detail">
        <SettingsForm>
          <section className="card">
            <div className="card-head"><h2>Gmail</h2>{isDemo && <DemoBadge />}</div>
            <div className="card-pad stack">
              <dl className="kv">
                <dt>Connected account</dt>
                <dd>
                  {isDemo ? <span className="faint">Demo workspace — no Gmail account</span>
                    : gmail ? <><strong>{gmail.email}</strong> {gmail.status === "connected" ? <span className="badge tone-green">Connected</span> : <span className="badge tone-red">Expired — reconnect</span>}</>
                      : <span className="faint">Not connected</span>}
                </dd>
                <dt>Permission</dt><dd><code>{GMAIL_SCOPE.replace("https://www.googleapis.com/auth/", "")}</code> <span className="faint small">(read-only)</span></dd>
                {gmail && (<><dt>Last sync</dt><dd>{gmail.last_sync_at ? formatDateTime(gmail.last_sync_at) : "Never"}{gmail.last_error && <div className="small" style={{ color: "var(--red)" }}>{gmail.last_error}</div>}</dd></>)}
              </dl>

              <label className="field">Which emails to process</label>
              <div className="radio-row">
                <label className="radio-pill"><input type="radio" name="sync_mode" value="recent" defaultChecked={s.sync_mode === "recent"} /> Recent emails</label>
                <label className="radio-pill"><input type="radio" name="sync_mode" value="label" defaultChecked={s.sync_mode === "label"} /> Only a Gmail label</label>
                <label className="radio-pill"><input type="radio" name="sync_mode" value="both" defaultChecked={s.sync_mode === "both"} /> Both (labelled AND recent)</label>
              </div>
              <label className="field">Gmail search query <span className="field-hint">used for “Recent emails” — standard Gmail search syntax</span>
                <input type="text" name="gmail_query" defaultValue={s.gmail_query} />
              </label>
              <div className="form-grid">
                <label className="field">Label filter <span className="field-hint">create it in Gmail first</span><input type="text" name="label_filter" defaultValue={s.label_filter} placeholder="AI-Task-Inbox" /></label>
                <label className="field">Emails per sync <span className="field-hint">max 50</span><input type="number" name="max_emails" min={1} max={50} defaultValue={s.max_emails} /></label>
                <label className="field span-2">Sync frequency
                  <select name="sync_frequency" defaultValue={s.sync_frequency}>
                    <option value="manual">Manual (Sync Emails button)</option>
                    <option value="hourly">Hourly (needs Vercel Pro cron)</option>
                    <option value="every_6_hours">Every 6 hours</option>
                    <option value="daily">Daily</option>
                  </select>
                </label>
              </div>
              <p className="small faint">Current effective query: <code>{buildQuery(s)}</code></p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>AI</h2><span className="sub">{env.aiConfigured ? "API key configured on server" : "No API key on server"}</span></div>
            <div className="card-pad form-grid">
              <label className="field">Model <span className="field-hint">blank = server default ({env.aiModel})</span><input type="text" name="ai_model" defaultValue={s.ai_model ?? ""} placeholder={env.aiModel} /></label>
              <label className="field">Confidence threshold <span className="field-hint">below this → Needs Review</span>
                <input type="number" name="confidence_threshold" min={0.3} max={0.99} step={0.01} defaultValue={s.confidence_threshold} />
              </label>
              <p className="small faint span-2">Using <code>{effectiveModel(s)}</code> via <code>{new URL(env.aiBaseUrl).host}</code> with strict JSON-schema output. Tasks are never created automatically, whatever the confidence.</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Task defaults</h2></div>
            <div className="card-pad form-grid">
              <label className="field">Default priority <span className="field-hint">for manual tasks</span>
                <select name="default_priority" defaultValue={s.default_priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}</select>
              </label>
              <label className="field">Status for approved tasks with an assignee
                <select name="default_status" defaultValue={s.default_status}>
                  <option value="new">New</option>
                  <option value="assigned">Assigned</option>
                </select>
              </label>
            </div>
          </section>
        </SettingsForm>

        <div className="stack">
          {!isDemo && (
            <section className="card">
              <div className="card-head"><h2>Gmail connection</h2></div>
              <div className="card-pad stack">
                <div className="row">
                  <ConnectGmailButton label={gmail ? "Reconnect Gmail" : "Connect Gmail"} size="btn-sm" />
                  {gmail && (
                    <form action={`${BASE_PATH}/api/gmail/disconnect`} method="post">
                      <ConfirmButton className="btn btn-sm btn-danger" message="Disconnect Gmail and revoke Google access? Synced emails and tasks stay.">Disconnect</ConfirmButton>
                    </form>
                  )}
                </div>
                <p className="small faint">Disconnect revokes the Google grant and deletes the encrypted tokens. You can also remove access any time at myaccount.google.com → Security → Third-party access.</p>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h2>Teams</h2></div>
            <div className="card-pad"><p className="muted">Add, edit or delete teams, members, skills and availability on the <Link href="/teams">Teams page →</Link></p></div>
          </section>

          <section className="card">
            <div className="card-head"><h2>AI quality signals</h2><span className="sub">early evaluation data</span></div>
            <div className="card-pad">
              <dl className="kv">
                <dt>Emails analysed</dt><dd>{q.analyses}</dd>
                <dt>Avg. confidence</dt><dd>{q.avg_conf != null ? `${Math.round(q.avg_conf * 100)}%` : "—"}</dd>
                <dt>Drafts approved</dt><dd>{q.approved_drafts}</dd>
                <dt>Drafts ignored</dt><dd>{q.ignored_drafts} <span className="faint small">(proxy for false positives)</span></dd>
                <dt>Assignment accepted</dt><dd>{acceptance != null ? `${acceptance}% of ${q.decided}` : "—"}</dd>
                <dt>AI failures</dt><dd>{q.failures}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Product events</h2><span className="sub">no email content is recorded</span></div>
            <div className="card-pad">
              {Object.keys(events).length === 0 ? <p className="faint small">No events yet.</p> : (
                <dl className="kv">{Object.entries(events).sort().map(([k, v]) => (<Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{v}</dd></Fragment>))}</dl>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
