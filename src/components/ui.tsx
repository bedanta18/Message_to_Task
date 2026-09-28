import { BASE_PATH } from "@/lib/base-path";
import { formatDate, relativeDue } from "@/lib/dates";
import {
  EMAIL_STATUS_LABEL, TASK_STATUS_LABEL, type Classification, type EmailStatus, type Priority, type TaskStatus,
} from "@/lib/types";

type Tone = "blue" | "green" | "amber" | "red" | "violet" | "teal" | "gray";

export function Badge({ tone = "gray", children, dot, title }: { tone?: Tone; children: React.ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<TaskStatus, Tone> = {
  new: "blue", assigned: "violet", in_progress: "teal", waiting_for_client: "amber", completed: "green", cancelled: "gray",
};
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{TASK_STATUS_LABEL[status]}</Badge>;
}

const PRIORITY_TONE: Record<Priority, Tone> = { low: "gray", medium: "blue", high: "amber", urgent: "red" };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{priority[0]!.toUpperCase() + priority.slice(1)}</Badge>;
}

const EMAIL_TONE: Record<EmailStatus, Tone> = {
  pending: "gray", action_required: "blue", needs_review: "amber", no_action: "gray", ignored: "gray", processed: "green", error: "red",
};
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <Badge tone={EMAIL_TONE[status]} dot>{EMAIL_STATUS_LABEL[status]}</Badge>;
}

const CLASS_LABEL: Record<Classification, [string, Tone]> = {
  ACTION_REQUIRED: ["Action required", "blue"],
  NO_ACTION: ["No action", "gray"],
  UNCERTAIN: ["Uncertain", "amber"],
};
export function ClassificationBadge({ value }: { value: string | null }) {
  if (!value || !(value in CLASS_LABEL)) return null;
  const [label, tone] = CLASS_LABEL[value as Classification];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Confidence({ value, label = true }: { value: number | null | undefined; label?: boolean }) {
  if (value == null) return <span className="faint small">—</span>;
  const pct = Math.round(Number(value) * 100);
  const color = pct >= 85 ? "var(--green)" : pct >= 70 ? "var(--a1)" : "var(--amber)";
  return (
    <span className="conf" title={`AI confidence ${pct}%`}>
      <span className="conf-bar"><span style={{ width: `${pct}%`, background: color }} /></span>
      {label && <span style={{ color }}>{pct}%</span>}
    </span>
  );
}

export function DueBadge({ deadline, done }: { deadline: string | null; done?: boolean }) {
  const d = relativeDue(deadline);
  if (done) return <span className="faint small">{deadline ? formatDate(deadline) : "—"}</span>;
  const tone: Tone = d.tone === "overdue" ? "red" : d.tone === "today" ? "amber" : "gray";
  if (d.tone === "none") return <span className="faint small">No deadline</span>;
  return <Badge tone={tone}>{d.label}</Badge>;
}

export function DemoBadge() {
  return <span className="badge badge-demo" title="Synthetic demo data — not a real email">Demo</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Connect Gmail is a plain link to the OAuth start route (a full navigation, never fetch). */
export function ConnectGmailButton({ label = "Connect Gmail", size = "" }: { label?: string; size?: "" | "btn-lg" | "btn-sm" }) {
  return (
    <a className={`btn btn-primary btn-google ${size}`} href={`${BASE_PATH}/api/auth/google/start`}>
      <span style={{ background: "#fff", borderRadius: 4, display: "inline-grid", padding: 2 }}><GoogleIcon /></span>
      {label}
    </a>
  );
}
