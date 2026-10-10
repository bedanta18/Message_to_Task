import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJson, retryAfterMs } from "@/lib/ai/client";
import { analysisJsonSchema } from "@/lib/ai/schema";
import { json, mockFetch } from "./helpers";

const ok = () => json({ model: "m", choices: [{ message: { content: '{"ok":true}' } }] });
const call = () => chatJson({ model: "m", system: "SYS", user: "USER" });
const body = (init?: RequestInit) => JSON.parse(String(init?.body));

const saved = { ...process.env };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env = { ...saved };
});

describe("OpenAI-compatible provider options (Groq, Gemini, Ollama…)", () => {
  it("json_object mode puts the schema in the system prompt (providers without strict schemas, e.g. Llama on Groq)", async () => {
    process.env.AI_RESPONSE_FORMAT = "json_object";
    const { calls } = mockFetch({ "https://api.openai.com/v1/chat/completions": ok });
    await call();
    const b = body(calls[0]!.init);
    expect(b.response_format).toEqual({ type: "json_object" });
    expect(b.messages[0].content).toContain("SYS");
    expect(b.messages[0].content).toContain(JSON.stringify(analysisJsonSchema));
  });

  it("strict json_schema mode leaves the system prompt untouched", async () => {
    const { calls } = mockFetch({ "https://api.openai.com/v1/chat/completions": ok });
    await call();
    expect(body(calls[0]!.init).messages[0].content).toBe("SYS");
  });

  it("sends reasoning_effort only when configured", async () => {
    const { calls } = mockFetch({ "https://api.openai.com/v1/chat/completions": ok });
    await call();
    expect(body(calls[0]!.init)).not.toHaveProperty("reasoning_effort");
    process.env.AI_REASONING_EFFORT = "low";
    await call();
    expect(body(calls[1]!.init).reasoning_effort).toBe("low");
  });

  it("uses AI_BASE_URL (e.g. https://api.groq.com/openai/v1)", async () => {
    process.env.AI_BASE_URL = "https://api.groq.com/openai/v1/";
    const { calls } = mockFetch({ "https://api.groq.com/openai/v1/chat/completions": ok });
    await call();
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("waits for retry-after on 429 and then succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    const { calls } = mockFetch({
      "https://api.openai.com/v1/chat/completions": () =>
        ++n === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "2" } }) : ok(),
    });
    const p = call();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toHaveLength(1); // still waiting
    await vi.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toMatchObject({ content: '{"ok":true}' });
    expect(calls).toHaveLength(2);
  });

  it("gives up with a readable rate-limit message after repeated 429s", async () => {
    vi.useFakeTimers();
    const { calls } = mockFetch({ "https://api.openai.com/v1/chat/completions": () => new Response("{}", { status: 429, headers: { "retry-after": "1" } }) });
    const p = call();
    const assertion = expect(p).rejects.toMatchObject({ code: "ai_upstream", userMessage: expect.stringContaining("rate-limiting") });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(calls).toHaveLength(4); // first try + 2 rate-limit waits + 1 normal retry
  });

  it("caps very long retry-after values", () => {
    expect(retryAfterMs(new Response("", { headers: { "retry-after": "600" } }))).toBe(15_000);
    expect(retryAfterMs(new Response(""))).toBe(5_000);
  });
});
