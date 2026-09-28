import { z } from "zod";
import { one, query } from "../db";
import { env } from "../env";
import { PRIORITIES, type SettingsRow } from "../types";

export async function getSettings(workspaceId: string): Promise<SettingsRow> {
  let s = await one<SettingsRow>("select * from settings where workspace_id = $1", [workspaceId]);
  if (!s) {
    await query("insert into settings (workspace_id) values ($1) on conflict do nothing", [workspaceId]);
    s = await one<SettingsRow>("select * from settings where workspace_id = $1", [workspaceId]);
  }
  return { ...s!, confidence_threshold: Number(s!.confidence_threshold) };
}

export function effectiveModel(s: SettingsRow): string {
  return s.ai_model?.trim() || env.aiModel;
}

export const SettingsInput = z.object({
  sync_mode: z.enum(["recent", "label", "both"]),
  gmail_query: z.string().trim().max(500),
  label_filter: z.string().trim().max(100),
  max_emails: z.coerce.number().int().min(1).max(50),
  sync_frequency: z.enum(["manual", "hourly", "every_6_hours", "daily"]),
  ai_model: z.string().trim().max(100).optional().transform((v) => v || null),
  confidence_threshold: z.coerce.number().min(0.3).max(0.99),
  default_priority: z.enum(PRIORITIES),
  default_status: z.enum(["new", "assigned"]),
});

export async function updateSettings(workspaceId: string, input: z.infer<typeof SettingsInput>): Promise<void> {
  if ((input.sync_mode === "label" || input.sync_mode === "both") && !input.label_filter) {
    throw new Error("A Gmail label is required for label-based sync.");
  }
  await getSettings(workspaceId);
  await query(
    `update settings set sync_mode = $2, gmail_query = $3, label_filter = $4, max_emails = $5, sync_frequency = $6,
            ai_model = $7, confidence_threshold = $8, default_priority = $9, default_status = $10, updated_at = now()
      where workspace_id = $1`,
    [workspaceId, input.sync_mode, input.gmail_query, input.label_filter, input.max_emails, input.sync_frequency,
      input.ai_model, input.confidence_threshold, input.default_priority, input.default_status],
  );
}
