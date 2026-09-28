import { z } from "zod";
import { CLASSIFICATIONS, PRIORITIES } from "../types";

/**
 * Contract between the LLM and the backend. The JSON Schema is sent to the model
 * (strict structured output); the Zod schema re-validates whatever comes back,
 * because raw LLM output is never trusted.
 */
export const PROMPT_VERSION = "2026-09-v1";

export const AiTaskSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000),
  deliverable: z.string().trim().max(300).nullable(),
  client: z.string().trim().max(160).nullable(),
  priority: z.enum(PRIORITIES),
  deadline: z.string().nullable(),
  deadline_text: z.string().max(200).nullable(),
  dependencies: z.array(z.string().max(300)).max(10),
  instructions: z.array(z.string().max(500)).max(15),
  suggested_team: z.string().max(80).nullable(),
  suggested_assignee: z.string().max(80).nullable(),
  assignment_reason: z.string().max(400).nullable(),
  confidence: z.number().min(0).max(1),
});

export const AiAnalysisSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(600),
  client: z.string().trim().max(160).nullable(),
  tasks: z.array(AiTaskSchema).max(8),
});

export type AiTask = z.infer<typeof AiTaskSchema>;
export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;

const nullableString = { type: ["string", "null"] };

const taskJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "description", "deliverable", "client", "priority", "deadline", "deadline_text",
    "dependencies", "instructions", "suggested_team", "suggested_assignee", "assignment_reason", "confidence",
  ],
  properties: {
    title: { type: "string", description: "Short imperative task title, max ~10 words." },
    description: { type: "string", description: "What needs to be done, using only facts from the email." },
    deliverable: { ...nullableString, description: "Concrete output requested, or null if not stated." },
    client: { ...nullableString, description: "Client / company the work is for, or null if not identifiable." },
    priority: { type: "string", enum: [...PRIORITIES] },
    deadline: { ...nullableString, description: "Resolved deadline as YYYY-MM-DD, or null if the email states none." },
    deadline_text: { ...nullableString, description: "The exact words in the email that state the deadline, or null." },
    dependencies: { type: "array", items: { type: "string" }, description: "Things this task waits on (assets, approvals, other tasks)." },
    instructions: { type: "array", items: { type: "string" }, description: "Important specific instructions from the email." },
    suggested_team: { ...nullableString, description: "Exactly one team name from the directory, or null." },
    suggested_assignee: { ...nullableString, description: "Exactly one member name from the directory, or null." },
    assignment_reason: { ...nullableString, description: "One sentence explaining the team/assignee recommendation." },
    confidence: { type: "number", description: "0-1 confidence that this task was correctly extracted." },
  },
} as const;

export const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "confidence", "reason", "client", "tasks"],
  properties: {
    classification: { type: "string", enum: [...CLASSIFICATIONS] },
    confidence: { type: "number", description: "0-1 confidence in the classification." },
    reason: { type: "string", description: "One or two sentences explaining the classification." },
    client: nullableString,
    tasks: { type: "array", items: taskJsonSchema, description: "Empty unless classification is ACTION_REQUIRED." },
  },
} as const;
