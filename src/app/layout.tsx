import type { Metadata } from "next";
import { Manrope, Syne } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { ConnectGmailButton, DemoBadge } from "@/components/ui";
import { getCurrent } from "@/lib/current";
import { BASE_PATH } from "@/lib/base-path";
import { one } from "@/lib/db";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-syne", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Agency Action Hub", template: "%s · Agency Action Hub" },
  description: "Turn client emails into actionable tasks. An AI micro-tool by Bedanta Gogoi.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrent();
  const html = (body: React.ReactNode) => (
    <html lang="en" className={`${syne.variable} ${manrope.variable}`}>
      <body>{body}</body>
    </html>
  );
  if (!current) return html(children);

  const counts = await one<{ inbox: number; tasks: number }>(
    `select (select count(*)::int from emails where workspace_id = $1 and status in ('action_required', 'needs_review')) as inbox,
            (select count(*)::int from tasks where workspace_id = $1 and status not in ('completed', 'cancelled')) as tasks`,
    [current.workspace.id],
  );
  const g = current.gmail;

  return html(
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">A</span>
          <span>
            <div className="brand-name">Agency Action Hub</div>
            <div className="brand-sub">Turn client emails into actionable tasks.</div>
          </span>
        </Link>
        <Nav counts={counts ?? { inbox: 0, tasks: 0 }} />
        <div className="sidebar-foot">
          <span>AI detects → extracts → recommends. You review → approve → assign.</span>
          <a href="https://www.aipmbedanta.com/">← aipmbedanta.com</a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          {current.isDemo ? (
            <>
              <span className="row small muted" style={{ marginRight: "auto" }}>
                <DemoBadge /> You’re exploring a demo workspace with synthetic emails. Nothing here touches a real inbox.
              </span>
              <ConnectGmailButton size="btn-sm" label="Connect Gmail (owner)" />
            </>
          ) : g && g.status === "connected" ? (
            <span className="gmail-pill" title={g.last_sync_at ? `Last sync ${new Date(g.last_sync_at).toLocaleString("en-GB")}` : "Not synced yet"}>
              <span className="dot" /> Gmail connected: <strong>{g.email}</strong>
            </span>
          ) : g ? (
            <>
              <span className="gmail-pill expired"><span className="dot" /> Gmail connection expired: {g.email}</span>
              <ConnectGmailButton size="btn-sm" label="Reconnect Gmail" />
            </>
          ) : (
            <ConnectGmailButton size="btn-sm" />
          )}
          <form action={`${BASE_PATH}/api/auth/logout`} method="post">
            <button className="btn btn-ghost btn-sm">{current.isDemo ? "Exit demo" : "Sign out"}</button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>,
  );
}
