import Link from "next/link";
import { SyncButton } from "@/components/SyncButton";
import { ClassificationBadge, Confidence, DemoBadge, EmailStatusBadge, Empty } from "@/components/ui";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { pageContext, param, type SearchParams } from "@/lib/page";
import { listEmails } from "@/lib/repo/emails";
import type { EmailStatus } from "@/lib/types";

export const metadata = { title: "Inbox" };

const TABS: { key: EmailStatus | "all" | "open"; label: string }[] = [
  { key: "open", label: "To review" },
  { key: "action_required", label: "Action Required" },
  { key: "needs_review", label: "Needs Review" },
  { key: "processed", label: "Tasks created" },
  { key: "no_action", label: "No Action" },
  { key: "ignored", label: "Ignored" },
  { key: "pending", label: "Pending" },
  { key: "error", label: "Failed" },
  { key: "all", label: "All" },
];

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const { workspace, isDemo, gmail } = await pageContext();
  const sp = await searchParams;
  const tab = (param(sp, "tab") ?? "open") as (typeof TABS)[number]["key"];
  const q = param(sp, "q") ?? "";
  const [emails, counts] = await Promise.all([
    listEmails(workspace.id, { status: tab, q }),
    query<{ status: string; n: number }>("select status, count(*)::int as n from emails where workspace_id = $1 group by status", [workspace.id]),
  ]);
  const count = (k: string) =>
    k === "all" ? counts.reduce((a, c) => a + c.n, 0)
      : k === "open" ? counts.filter((c) => c.status === "action_required" || c.status === "needs_review").reduce((a, c) => a + c.n, 0)
        : counts.find((c) => c.status === k)?.n ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>Every synced email with the AI’s classification. Open one to review its suggested tasks.</p>
        </div>
        {!isDemo && gmail?.status === "connected" && <div className="row"><SyncButton mode="analyze" className="btn" /><SyncButton /></div>}
      </div>

      <nav className="tabs" aria-label="Email filters">
        {TABS.filter((t) => ["open", "action_required", "needs_review", "all"].includes(t.key) || count(t.key) > 0).map((t) => (
          <Link key={t.key} href={{ pathname: "/inbox", query: { tab: t.key, ...(q ? { q } : {}) } }} className={tab === t.key ? "active" : ""}>
            {t.label}<span className="n">{count(t.key)}</span>
          </Link>
        ))}
      </nav>

      <form className="row" style={{ marginBottom: 14 }}>
        <input type="hidden" name="tab" value={tab} />
        <input type="search" name="q" defaultValue={q} placeholder="Search subject, sender, client or task…" style={{ maxWidth: 420 }} />
        <button className="btn">Search</button>
        {q && <Link className="btn btn-ghost" href={`/inbox?tab=${tab}`}>Clear</Link>}
      </form>

      <section className="card">
        {emails.length === 0 ? (
          <Empty>{q ? "No emails match that search." : tab === "open" ? "Nothing to review right now." : "No emails in this view."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Email</th><th>From</th><th>Received</th><th>AI</th><th>Confidence</th><th>Status</th></tr></thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td style={{ maxWidth: 380 }}>
                      <Link href={`/inbox/${e.id}`} className="strong" style={{ color: "var(--tx1)" }}>{e.subject}</Link>
                      <div className="small faint truncate">{e.snippet}</div>
                    </td>
                    <td className="small"><div className="row">{e.is_demo && <DemoBadge />}{e.from_name ?? e.from_email}</div></td>
                    <td className="small nowrap">{formatDateTime(e.received_at)}</td>
                    <td><ClassificationBadge value={e.classification} /></td>
                    <td><Confidence value={e.confidence} /></td>
                    <td>
                      <EmailStatusBadge status={e.status} />
                      {e.pending_requirements > 0 && <div className="small faint">{e.pending_requirements} to approve</div>}
                      {e.task_count > 0 && <div className="small faint">{e.task_count} task{e.task_count === 1 ? "" : "s"}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
