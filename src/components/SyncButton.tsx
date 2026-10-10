"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BASE_PATH } from "@/lib/base-path";

type SyncResult = {
  found: number; new: number; duplicates: number; skipped: number; notFetched: number; analyzed: number;
  actionRequired: number; needsReview: number; noAction: number; failed: number; remaining: number; errors: string[];
};

type MaxEmails = number | "all";
type Range = { id: string; label: string; after: number; before?: number };
/** Inclusive calendar dates (YYYY-MM-DD, viewer's local time) for "Custom dates…". */
type CustomDates = { from: string; to: string };
type Prefs = { range?: string; maxEmails?: MaxEmails; dates?: CustomDates };

const MAX_OPTIONS = [10, 20, 50, 100, 200];
const CUSTOM_MAX = 1000; // keep in sync with MAX_SYNC_EMAILS on the server
const ROLLING_DAYS = [3, 7, 14, 30, 60, 90, 180, 365];
const PREFS_KEY = "aah.syncPrefs";

const sec = (d: Date | number) => Math.floor(Number(d) / 1000);
const startOfDay = (offsetDays = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Local midnight of a YYYY-MM-DD date, optionally shifted by whole days. */
const localMidnight = (ymd: string, plusDays = 0) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y!, m! - 1, d! + plusDays); };
const shortDate = (ymd: string) => localMidnight(ymd).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Why a custom date range can't be used yet, or null when it's fine. */
function customDatesError(d: CustomDates): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from) || !/^\d{4}-\d{2}-\d{2}$/.test(d.to)) return "Pick both dates.";
  if (d.from > d.to) return "“From” must be on or before “To”.";
  if (d.from > isoDate(new Date())) return "“From” can’t be in the future.";
  return null;
}

/** Resolves a range id to a concrete window in the viewer's local time, computed at the moment of use. */
function resolveRange(id: string, dates?: CustomDates): Range {
  if (id === "custom" && dates) {
    const label = dates.from === dates.to ? shortDate(dates.from) : `${shortDate(dates.from)} – ${shortDate(dates.to)}`;
    return { id, label, after: sec(localMidnight(dates.from)), before: sec(localMidnight(dates.to, 1)) };
  }
  if (id === "today") return { id, label: "Today", after: sec(startOfDay()) };
  if (id === "yesterday") return { id, label: "Yesterday", after: sec(startOfDay(-1)), before: sec(startOfDay()) };
  if (id === "24h") return { id, label: "Last 24 hours", after: sec(Date.now() - 86_400_000) };
  const days = Number(id.replace(/d$/, "")) || 7;
  return { id: `${days}d`, label: `Last ${days} days`, after: sec(Date.now() - days * 86_400_000) };
}

/** Maps the saved settings' day count onto a range id. */
const rangeIdForDays = (days: number) => (days <= 1 ? "24h" : `${days}d`);

/** Adds `value` to a preset list (sorted) so a saved setting outside the presets still shows. */
const withValue = (opts: number[], value: number) => (opts.includes(value) ? opts : [...opts, value].sort((a, b) => a - b));

/** Calls the sync (or analyse-pending) API and summarises the outcome in plain language. */
export function SyncButton({
  mode = "sync", label, className = "btn btn-primary", defaultDays = 7, defaultMax = 25,
}: { mode?: "sync" | "analyze"; label?: string; className?: string; defaultDays?: number; defaultMax?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warn"; text: string; code?: string } | null>(null);
  const [rangeId, setRangeId] = useState(rangeIdForDays(defaultDays));
  // Start from the preset closest to the saved "Emails per sync"; a custom number saved in this browser still wins.
  const startMax = MAX_OPTIONS.reduce((best, n) => (Math.abs(n - defaultMax) < Math.abs(best - defaultMax) ? n : best));
  const [maxEmails, setMaxEmails] = useState<MaxEmails>(startMax);
  // "Custom number…" shows a free-entry box; the raw text is kept so the field can be cleared while typing.
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState(String(startMax));
  const customValue = Number(customText);
  const customValid = Number.isInteger(customValue) && customValue >= 1 && customValue <= CUSTOM_MAX;
  // "Custom dates…" range; defaults to the last week.
  const [dates, setDates] = useState<CustomDates>(() => ({ from: isoDate(startOfDay(-7)), to: isoDate(new Date()) }));
  const datesError = rangeId === "custom" ? customDatesError(dates) : null;
  // Number of emails in the chosen range (null while loading / unavailable).
  const [estimate, setEstimate] = useState<number | null>(null);

  const rangeIds = ["today", "yesterday", "24h", ...withValue(ROLLING_DAYS, Number(rangeId.replace(/d$/, "")) || 3).map((d) => `${d}d`)];
  const range = resolveRange(rangeId, dates);

  // Remember the last choice per browser; fall back to the saved settings.
  useEffect(() => {
    if (mode !== "sync") return;
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Prefs | null;
      if (saved?.range && /^(today|yesterday|24h|custom|\d+d)$/.test(saved.range)) setRangeId(saved.range);
      if (saved?.dates?.from && saved.dates.to) setDates(saved.dates);
      if (saved?.maxEmails === "all") setMaxEmails("all");
      else if (typeof saved?.maxEmails === "number" && saved.maxEmails >= 1 && saved.maxEmails <= CUSTOM_MAX) {
        setMaxEmails(saved.maxEmails);
        setCustom(!MAX_OPTIONS.includes(saved.maxEmails));
        setCustomText(String(saved.maxEmails));
      }
    } catch {}
  }, [mode]);

  // Range first: look up how many emails it holds, shown on the "All emails" option.
  useEffect(() => {
    if (mode !== "sync") return;
    let cancelled = false;
    setEstimate(null);
    if (rangeId === "custom" && customDatesError(dates)) return;
    const r = resolveRange(rangeId, dates);
    const qs = new URLSearchParams({ after: String(r.after), ...(r.before ? { before: String(r.before) } : {}) });
    fetch(`${BASE_PATH}/api/gmail/count?${qs}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; estimate?: number }) => { if (!cancelled && data.ok && typeof data.estimate === "number") setEstimate(data.estimate); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, rangeId, dates]);

  /** Merges into this browser's remembered choices. */
  function savePrefs(next: Prefs) {
    try {
      const prev = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Prefs | null;
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, ...next }));
    } catch {}
  }

  function changeDates(next: CustomDates) {
    setDates(next);
    if (!customDatesError(next)) savePrefs({ dates: next });
  }

  function chooseCount(value: string) {
    if (value === "custom") {
      setCustom(true);
      if (typeof maxEmails === "number") setCustomText(String(maxEmails));
      return;
    }
    const v: MaxEmails = value === "all" ? "all" : Number(value);
    setCustom(false);
    setMaxEmails(v);
    savePrefs({ maxEmails: v });
  }

  function typeCustom(text: string) {
    setCustomText(text);
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= CUSTOM_MAX) {
      setMaxEmails(n);
      savePrefs({ maxEmails: n });
    }
  }

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      // Re-resolve at click time so "Today" / "Last 24 hours" are exact even if the page sat open.
      const r = resolveRange(rangeId, dates);
      const body = mode === "sync" ? JSON.stringify({ range: { after: r.after, before: r.before }, maxEmails }) : "{}";
      const res = await fetch(`${BASE_PATH}/api/gmail/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const data = (await res.json().catch(() => null)) as { ok: boolean; error?: string; code?: string; result?: SyncResult } | null;
      if (!res.ok || !data?.ok || !data.result) {
        setMsg({ tone: "error", text: data?.error ?? "Sync failed. Please try again.", code: data?.code });
      } else {
        const r = data.result;
        const parts =
          mode === "sync"
            ? [r.found === 0
                ? `No emails matched your Gmail filter for “${range.label}”.`
                : `${r.found} emails checked, ${r.new} new${r.duplicates ? `, ${r.duplicates} already synced` : ""}.${typeof maxEmails === "number" && r.found >= maxEmails ? ` Hit the ${maxEmails}-email limit — raise it to fetch older mail.` : ""}`]
            : [];
        if (r.notFetched) parts.push(`${r.notFetched} more not fetched yet — click “Sync Emails” again to continue.`);
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
      {mode === "sync" && (
        <span className="sync-range" aria-label="Sync range">
          <select
            aria-label="Date range" value={rangeId} disabled={busy}
            onChange={(e) => { setRangeId(e.target.value); savePrefs({ range: e.target.value }); }}
          >
            {rangeIds.map((id) => <option key={id} value={id}>{resolveRange(id).label}</option>)}
            <option value="custom">Custom dates…</option>
          </select>
          {rangeId === "custom" && (
            <span className="sync-dates">
              <label>
                From
                <input
                  type="date" value={dates.from} max={isoDate(new Date())} disabled={busy} aria-invalid={!!datesError}
                  onChange={(e) => changeDates({ ...dates, from: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date" value={dates.to} min={dates.from} max={isoDate(new Date())} disabled={busy} aria-invalid={!!datesError}
                  onChange={(e) => changeDates({ ...dates, to: e.target.value })}
                />
              </label>
            </span>
          )}
          <select aria-label="Number of emails" value={custom ? "custom" : String(maxEmails)} disabled={busy} onChange={(e) => chooseCount(e.target.value)}>
            {MAX_OPTIONS.map((n) => <option key={n} value={n}>Latest {n} emails</option>)}
            <option value="custom">Custom number…</option>
            <option value="all">All emails{estimate !== null ? ` (${estimate >= 1000 ? "1000+" : estimate})` : ""}</option>
          </select>
          {custom && (
            <input
              type="number" className="sync-count" aria-label="Custom number of emails" min={1} max={CUSTOM_MAX} step={1}
              value={customText} disabled={busy} aria-invalid={!customValid} autoFocus
              onChange={(e) => typeCustom(e.target.value)}
              title={`Enter 1–${CUSTOM_MAX}`}
            />
          )}
          {datesError && <span className="sync-error">{datesError}</span>}
        </span>
      )}
      <button type="button" className={className} onClick={run} disabled={busy || (mode === "sync" && ((custom && !customValid) || !!datesError))}>
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
