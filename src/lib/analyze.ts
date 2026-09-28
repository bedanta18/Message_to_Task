import { chatJson } from "./ai/client";
import { decideEmailStatus, normalizeAnalysis, parseAiOutput, type NormalizedAnalysis } from "./ai/normalize";
import { buildUserPrompt, SYSTEM_PROMPT } from "./ai/prompt";
import { PROMPT_VERSION } from "./ai/schema";
import { query, tx, type Db } from "./db";
import { AppError, toUserMessage } from "./errors";
import { getEmail } from "./repo/emails";
import { track } from "./repo/events";
import { effectiveModel, getSettings } from "./repo/settings";
import { getDirectory } from "./repo/teams";
import type { EmailRow, EmailStatus } from "./types";

export interface AnalyzeResult {
  emailId: string;
  status: EmailStatus;
  classification?: string;
  confidence?: number;
  error?: string;
}

/**
 * Detect → Extract → Recommend for one email. Never creates tasks: it stores the
 * AI output and task drafts, and routes the email to Action Required or Needs Review.
 */
export async function analyzeEmail(workspaceId: string, emailId: string): Promise<AnalyzeResult> {
  const email = await getEmail(workspaceId, emailId);
  if (!email) throw new AppError("not_found", "Email not found.", { status: 404 });
  if (email.status === "processed") {
    throw new AppError("already_processed", "Tasks were already created from this email.", { status: 409 });
  }

  const [settings, { teams, members }] = await Promise.all([getSettings(workspaceId), getDirectory(workspaceId)]);
  const model = effectiveModel(settings);
  const user = buildUserPrompt(email, teams, members);

  let raw = "";
  let usedModel = model;
  let latency = 0;
  try {
    let normalized: NormalizedAnalysis | null = null;
    // One extra attempt if the model's JSON fails validation.
    for (let attempt = 0; attempt < 2 && !normalized; attempt++) {
      const res = await chatJson({ model, system: SYSTEM_PROMPT, user });
      raw = res.content;
      usedModel = res.model;
      latency += res.latencyMs;
      try {
        normalized = normalizeAnalysis(parseAiOutput(raw), email, teams, members);
      } catch (e) {
        if (attempt === 1) throw e;
      }
    }
    const status = await persistAnalysis(workspaceId, email, {
      model: usedModel, raw, analysis: normalized!, latencyMs: latency, threshold: settings.confidence_threshold,
    });
    return { emailId, status, classification: normalized!.classification, confidence: normalized!.confidence };
  } catch (e) {
    const message = toUserMessage(e);
    await query(
      "insert into ai_analyses (workspace_id, email_id, model, prompt_version, raw_output, latency_ms, error) values ($1, $2, $3, $4, $5, $6, $7)",
      [workspaceId, emailId, usedModel, PROMPT_VERSION, raw.slice(0, 20000) || null, latency || null, e instanceof AppError ? e.code : "unknown"],
    );
    await query("update emails set status = 'error', error = $3 where id = $1 and workspace_id = $2", [emailId, workspaceId, message]);
    return { emailId, status: "error", error: message };
  }
}

/** Stores an analysis + its task drafts and moves the email into the right queue. */
export async function persistAnalysis(
  workspaceId: string,
  email: Pick<EmailRow, "id">,
  r: { model: string; raw: string; analysis: NormalizedAnalysis; latencyMs: number | null; threshold: number },
  d?: Db,
): Promise<EmailStatus> {
  const a = r.analysis;
  const status = decideEmailStatus(a, r.threshold);
  const run = async (t: Db) => {
    const [row] = await t.query<{ id: string }>(
      `insert into ai_analyses (workspace_id, email_id, model, prompt_version, classification, confidence, output, raw_output, latency_ms)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) returning id`,
      [workspaceId, email.id, r.model, PROMPT_VERSION, a.classification, a.confidence, JSON.stringify(a), r.raw.slice(0, 20000), r.latencyMs],
    );
    // Re-analysis replaces only drafts that a human has not acted on yet.
    await t.query("delete from requirements where email_id = $1 and status = 'pending'", [email.id]);
    const [{ next }] = (await t.query<{ next: number }>(
      "select coalesce(max(idx) + 1, 0)::int as next from requirements where email_id = $1",
      [email.id],
    )) as [{ next: number }];
    let idx = next;
    for (const task of a.tasks) {
      await t.query(
        `insert into requirements (workspace_id, email_id, analysis_id, idx, title, description, deliverable, client, priority,
                                   deadline, deadline_text, dependencies, instructions, suggested_team_id, suggested_member_id,
                                   assignment_reason, confidence)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17)`,
        [workspaceId, email.id, row!.id, idx++, task.title, task.description, task.deliverable, task.client, task.priority,
          task.deadline, task.deadline_text, JSON.stringify(task.dependencies), JSON.stringify(task.instructions),
          task.recommendation.teamId, task.recommendation.memberId, task.recommendation.reason, task.confidence],
      );
    }
    await t.query("update emails set status = $3, error = null where id = $1 and workspace_id = $2", [email.id, workspaceId, status]);
  };
  // With a caller-supplied transaction (demo seeding) we skip analytics: seeded
  // analyses are not real product usage, and it keeps all writes inside that tx.
  if (d) return (await run(d), status);
  await tx(run);

  await track(workspaceId, "email_classified", { classification: a.classification, confidence: Math.round(a.confidence * 100) / 100, queue: status });
  if (a.tasks.length) await track(workspaceId, "requirement_created", { count: a.tasks.length });
  return status;
}
