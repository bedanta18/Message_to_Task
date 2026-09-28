"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BASE_PATH } from "@/lib/base-path";

type SyncResult = {
  found: number; new: number; duplicates: number; skipped: number; analyzed: number;
  actionRequired: number; needsReview: number; noAction: number; failed: number; remaining: number; errors: string[];
};

/** Calls the sync (or analyse-pending) API and summarises the outcome in plain language. */
export function SyncButton({ mode = "sync", label, className = "btn btn-primary" }: { mode?: "sync" | "analyze"; label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warn"; text: string; code?: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/gmail/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await res.json().catch(() => null)) as { ok: boolean; error?: string; code?: string; result?: SyncResult } | null;
      if (!res.ok || !data?.ok || !data.result) {
        setMsg({ tone: "error", text: data?.error ?? "Sync failed. Please try again.", code: data?.code });
      } else {
        const r = data.result;
        const parts =
          mode === "sync"
            ? [r.found === 0 ? "No emails matched your Gmail filter." : `${r.found} emails checked, ${r.new} new${r.duplicates ? `, ${r.duplicates} already synced` : ""}.`]
            : [];
        if (r.analyzed) parts.push(`AI analysed ${r.analyzed}: ${r.actionRequired} action required, ${r.needsReview} need review, ${r.noAction} no action.`);
        else if (mode === "analyze") parts.push("Nothing left to analyse.");
        if (r.remaining) parts.push(`${r.remaining} still pending — click “Analyse pending” to continue.`);
        if (r.errors.length) parts.push(r.errors.join(" "));
        setMsg({ tone: r.failed || r.errors.length ? "warn" : "success", text: parts.join(" ") });
      }
    } catch {
      setMsg({ tone: "error", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={run} disabled={busy}>
        {busy ? (mode === "sync" ? "Syncing…" : "Analysing…") : (label ?? (mode === "sync" ? "Sync Emails" : "Analyse pending"))}
      </button>
      {msg && (
        <div className={`alert alert-${msg.tone} toast`} role="status">
          <div className="spread">
            <span>{msg.text}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button>
          </div>
          {msg.code === "gmail_expired" && (
            <a className="btn btn-sm" style={{ marginTop: 8 }} href={`${BASE_PATH}/api/auth/google/start`}>Reconnect Gmail</a>
          )}
        </div>
      )}
    </>
  );
}

export function ReanalyzeButton({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="row">
      <button
        type="button" className="btn btn-sm" disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const res = await fetch(`${BASE_PATH}/api/gmail/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailId }) }).catch(() => null);
          const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!data?.ok) setErr(data?.error ?? "Re-analysis failed.");
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "Analysing…" : "Re-analyse with AI"}
      </button>
      {err && <span className="small" style={{ color: "var(--red)" }}>{err}</span>}
    </span>
  );
}
