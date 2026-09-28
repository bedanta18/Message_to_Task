import { env } from "../env";
import { AiErrors, AppError } from "../errors";
import { analysisJsonSchema } from "./schema";

export interface ChatResult {
  content: string;
  model: string;
  latencyMs: number;
}

const TIMEOUT_MS = 35_000;

/**
 * Calls any OpenAI-compatible /chat/completions endpoint with a strict JSON
 * Schema response format (or json_object for providers without schema support).
 */
export async function chatJson(opts: { model: string; system: string; user: string; retries?: number }): Promise<ChatResult> {
  if (!env.openaiApiKey) throw AiErrors.notConfigured();
  const retries = opts.retries ?? 1;
  const started = Date.now();

  const response_format =
    env.aiResponseFormat === "json_schema"
      ? { type: "json_schema", json_schema: { name: "email_analysis", strict: true, schema: analysisJsonSchema } }
      : { type: "json_object" };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${env.aiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openaiApiKey}` },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.1,
          response_format,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (attempt < retries) continue;
      throw isTimeout ? AiErrors.timeout() : AiErrors.upstream(0, e);
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw AiErrors.upstream(res.status);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw AiErrors.upstream(res.status, new Error(text.slice(0, 500)));
    }

    const data = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      if (attempt < retries) continue;
      throw AiErrors.invalidOutput(new Error(data?.choices?.[0]?.message?.refusal ?? "empty completion"));
    }
    return { content, model: data?.model ?? opts.model, latencyMs: Date.now() - started };
  }
}

export function isRetryableAiError(e: unknown): boolean {
  return e instanceof AppError && (e.code === "ai_invalid_output" || e.code === "ai_timeout");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
