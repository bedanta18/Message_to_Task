import { GmailErrors } from "../errors";
import type { NewEmail } from "../repo/emails";
import type { SettingsRow } from "../types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailUnauthorized extends Error {}

/** GET against the Gmail API with retry/backoff for rate limits and transient failures. */
export async function gmailGet<T>(path: string, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const delays = [500, 1500, 4000];
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      if (attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }
      throw GmailErrors.unavailable(e);
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401) throw new GmailUnauthorized();
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit/i.test(await res.clone().text()));
    if (retryable && attempt < delays.length) {
      await sleep(delays[attempt]!);
      continue;
    }
    if (res.status === 429 || res.status === 403) throw GmailErrors.rateLimited();
    throw GmailErrors.unavailable(new Error(`Gmail API ${res.status}`));
  }
}

export async function getProfile(accessToken: string, fetchImpl?: typeof fetch): Promise<{ emailAddress: string }> {
  return gmailGet<{ emailAddress: string }>("/profile", accessToken, fetchImpl);
}

/**
 * Conservative query builder.
 *  - recent: the configured query (default: inbox, last 7 days, no promos/social/updates, not from me)
 *  - label:  only messages carrying the label
 *  - both:   only labeled messages that ALSO match the recent query (the most conservative option)
 */
export function buildQuery(s: Pick<SettingsRow, "sync_mode" | "gmail_query" | "label_filter">): string {
  const recent = s.gmail_query.trim() || "newer_than:7d";
  const label = s.label_filter.trim() ? `label:${quoteLabel(s.label_filter.trim())}` : "";
  if (s.sync_mode === "label") return label || recent;
  if (s.sync_mode === "both") return label ? `${label} ${recent}` : recent;
  return recent;
}

function quoteLabel(label: string): string {
  // Gmail label search uses hyphens for spaces; quote to be safe with special chars.
  const slug = label.replace(/\s+/g, "-");
  return /^[\w/-]+$/.test(slug) ? slug : `"${slug.replace(/"/g, "")}"`;
}

/** A time window in Unix seconds; `before` omitted means "until now". */
export interface SyncRange { after: number; before?: number }

/** Restricts a query to a time window, replacing any date terms already in it. */
export function withinRange(q: string, range: SyncRange): string {
  const base = q.replace(/(^|\s)(newer_than|older_than|after|before):\S+/gi, " ").replace(/\s+/g, " ").trim();
  const terms = [`after:${range.after}`, ...(range.before ? [`before:${range.before}`] : [])];
  return [base, ...terms].join(" ").trim();
}

/** Day count from a query's newer_than: (d/m/y units), used to pre-fill the sync range. */
export function daysInQuery(q: string): number | null {
  const m = /newer_than:(\d+)([dmy])/i.exec(q);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "d" ? n : m[2]!.toLowerCase() === "m" ? n * 30 : n * 365;
}

/** Ceiling for "All emails" — keeps one sync's ID listing to 20 Gmail calls. */
export const ALL_EMAILS_CAP = 1000;
/** Largest number a user can type for a manual sync. */
export const MAX_SYNC_EMAILS = ALL_EMAILS_CAP;

/** Lists up to `max` message IDs (newest first), paging through Gmail 50 at a time. */
export async function listMessageIds(accessToken: string, q: string, max: number, fetchImpl?: typeof fetch): Promise<string[]> {
  const limit = Math.min(Math.max(max, 1), ALL_EMAILS_CAP);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(limit - ids.length, 50)) });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`, accessToken, fetchImpl);
    ids.push(...(data.messages ?? []).map((m) => m.id));
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids.slice(0, limit);
}

/**
 * Counts messages matching a query (exact up to `cap`) by listing IDs 500 at a time.
 * Gmail's resultSizeEstimate is too unreliable to show to users.
 */
export async function countMessages(accessToken: string, q: string, cap = ALL_EMAILS_CAP, fetchImpl?: typeof fetch): Promise<number> {
  let count = 0;
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "500", fields: "messages/id,nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`, accessToken, fetchImpl);
    count += data.messages?.length ?? 0;
    pageToken = data.nextPageToken;
  } while (pageToken && count < cap);
  return Math.min(count, cap);
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export async function getMessage(accessToken: string, id: string, fetchImpl?: typeof fetch): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`, accessToken, fetchImpl);
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function findPart(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data && !part.filename) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove quoted reply history so the AI focuses on the new message. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l, i) => {
    const t = l.trim();
    return (
      /^On .+wrote:$/.test(t) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(t) ||
      (i > 0 && /^From: .+/.test(t) && /^(Sent|Date): /.test((lines[i + 1] ?? "").trim()))
    );
  });
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">"));
  return kept.join("\n").trim();
}

export function parseAddress(v: string | undefined): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim().toLowerCase() };
  const email = v.trim().toLowerCase();
  return { name: null, email: /@/.test(email) ? email : null };
}

/** Gmail API message → our email shape. Throws only on truly unusable input. */
export function parseMessage(msg: GmailMessage): NewEmail {
  if (!msg?.id) throw new Error("Invalid Gmail message: missing id");
  const headers = new Map((msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const from = parseAddress(headers.get("from"));
  const plain = findPart(msg.payload, "text/plain");
  const html = plain ? null : findPart(msg.payload, "text/html");
  const rawBody = plain ?? (html ? htmlToText(html) : msg.snippet ?? "");
  const body = stripQuoted(rawBody).slice(0, 20_000);
  const internal = Number(msg.internalDate);
  const headerDate = headers.get("date") ? Date.parse(headers.get("date")!) : NaN;
  const received = Number.isFinite(internal) && internal > 0 ? new Date(internal) : Number.isFinite(headerDate) ? new Date(headerDate) : new Date();
  return {
    source: "gmail",
    external_id: msg.id,
    thread_id: msg.threadId ?? null,
    from_name: from.name,
    from_email: from.email,
    to_addresses: headers.get("to") ?? null,
    cc_addresses: headers.get("cc") ?? null,
    subject: (headers.get("subject") ?? "(no subject)").slice(0, 500),
    snippet: (msg.snippet ?? "").slice(0, 500),
    body,
    received_at: received,
    labels: msg.labelIds ?? [],
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
