import { recommendAssignment, type Recommendation } from "../assignment";
import { isValidIsoDate } from "../dates";
import { AiErrors } from "../errors";
import type { Classification, EmailStatus, MemberRow, Priority, TeamRow } from "../types";
import { AiAnalysisSchema, type AiAnalysis } from "./schema";

export interface EmailEvidence {
  subject: string;
  body: string;
  from_name: string | null;
  from_email: string | null;
}

export interface NormalizedTask {
  title: string;
  description: string;
  deliverable: string | null;
  client: string | null;
  priority: Priority;
  deadline: string | null;
  deadline_text: string | null;
  dependencies: string[];
  instructions: string[];
  confidence: number;
  recommendation: Recommendation;
}

export interface NormalizedAnalysis {
  classification: Classification;
  confidence: number;
  reason: string;
  client: string | null;
  tasks: NormalizedTask[];
  /** Notes about fields the backend dropped because they were not supported by the email. */
  corrections: string[];
}

/** Parse raw model text into a validated AiAnalysis. Throws ai_invalid_output. */
export function parseAiOutput(content: string): AiAnalysis {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    throw AiErrors.invalidOutput(e);
  }
  const parsed = AiAnalysisSchema.safeParse(json);
  if (!parsed.success) throw AiErrors.invalidOutput(parsed.error);
  return parsed.data;
}

const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”"'’`]/g, "").trim();

function haystack(e: EmailEvidence): string {
  const domain = e.from_email?.split("@")[1]?.split(".")[0] ?? "";
  return squash([e.subject, e.body, e.from_name ?? "", e.from_email ?? "", domain].join(" \n "));
}

/** A client name is kept only if at least one distinctive word of it appears in the email. */
export function clientSupported(client: string, e: EmailEvidence): boolean {
  const hay = haystack(e);
  const words = squash(client).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["the", "and", "team", "client", "ltd", "pvt", "inc"].includes(w));
  return words.some((w) => hay.includes(w));
}

/** A deadline is kept only if it is a real date AND the stated wording exists in the email. */
export function deadlineSupported(deadline: string | null, deadlineText: string | null, e: EmailEvidence): boolean {
  if (!deadline || !isValidIsoDate(deadline)) return false;
  if (!deadlineText || deadlineText.trim().length < 2) return false;
  return haystack(e).includes(squash(deadlineText));
}

export function normalizeAnalysis(a: AiAnalysis, email: EmailEvidence, teams: TeamRow[], members: MemberRow[]): NormalizedAnalysis {
  const corrections: string[] = [];
  const topClient = a.client && clientSupported(a.client, email) ? a.client : null;
  if (a.client && !topClient) corrections.push(`Dropped client "${a.client}" (not found in email).`);

  const seen = new Set<string>();
  const tasks: NormalizedTask[] = [];
  const rawTasks = a.classification === "NO_ACTION" ? [] : a.tasks;

  for (const t of rawTasks) {
    const key = squash(t.title);
    if (seen.has(key)) continue;
    seen.add(key);

    let client = t.client && clientSupported(t.client, email) ? t.client : null;
    if (t.client && !client) corrections.push(`Dropped client "${t.client}" on "${t.title}" (not found in email).`);
    client ??= topClient;

    const deadlineOk = deadlineSupported(t.deadline, t.deadline_text, email);
    if (t.deadline && !deadlineOk) corrections.push(`Dropped deadline ${t.deadline} on "${t.title}" (not supported by email wording).`);

    const recommendation = recommendAssignment(
      {
        text: [t.title, t.description, t.deliverable ?? ""].join(" "),
        suggestedTeam: t.suggested_team,
        suggestedAssignee: t.suggested_assignee,
        aiReason: t.assignment_reason,
      },
      teams,
      members,
    );

    tasks.push({
      title: t.title.trim(),
      description: t.description.trim(),
      deliverable: t.deliverable?.trim() || null,
      client,
      priority: t.priority,
      deadline: deadlineOk ? t.deadline : null,
      deadline_text: deadlineOk ? t.deadline_text : null,
      dependencies: t.dependencies.map((d) => d.trim()).filter(Boolean),
      instructions: t.instructions.map((d) => d.trim()).filter(Boolean),
      confidence: t.confidence,
      recommendation,
    });
  }

  return { classification: a.classification, confidence: a.confidence, reason: a.reason, client: topClient, tasks, corrections };
}

/**
 * Human-in-the-loop gate. Nothing becomes a task automatically; this only decides
 * which queue the email lands in. Below the threshold → Needs Review.
 */
export function decideEmailStatus(a: Pick<NormalizedAnalysis, "classification" | "confidence" | "tasks">, threshold: number): EmailStatus {
  if (a.classification === "ACTION_REQUIRED" && a.confidence >= threshold && a.tasks.length > 0) return "action_required";
  if (a.classification === "NO_ACTION" && a.confidence >= threshold) return "no_action";
  return "needs_review";
}
