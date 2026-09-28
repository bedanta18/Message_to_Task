import { env } from "./env";

/** 'YYYY-MM-DD' for a moment in the agency's timezone (default Asia/Kolkata). */
export function isoDateInTz(d: Date = new Date(), tz = env.timezone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function todayIso(): string {
  return isoDateInTz(new Date());
}

export function weekdayInTz(d: Date, tz = env.timezone): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
}

export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: env.timezone,
  }).format(date);
}

export function relativeDue(iso: string | null, today = todayIso()): { label: string; tone: "overdue" | "today" | "soon" | "later" | "none" } {
  if (!iso) return { label: "No deadline", tone: "none" };
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff < 0) return { label: `${-diff}d overdue`, tone: "overdue" };
  if (diff === 0) return { label: "Due today", tone: "today" };
  if (diff === 1) return { label: "Due tomorrow", tone: "soon" };
  if (diff <= 7) return { label: `Due in ${diff}d`, tone: "soon" };
  return { label: formatDate(iso), tone: "later" };
}
