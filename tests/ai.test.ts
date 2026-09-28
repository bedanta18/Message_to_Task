import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeEmail } from "@/lib/analyze";
import { decideEmailStatus, deadlineSupported, normalizeAnalysis, parseAiOutput } from "@/lib/ai/normalize";
import { buildUserPrompt } from "@/lib/ai/prompt";
import { analysisJsonSchema, type AiAnalysis } from "@/lib/ai/schema";
import { query, tx } from "@/lib/db";
import { insertEmailIfNew, latestAnalysis, listRequirements } from "@/lib/repo/emails";
import { getDirectory } from "@/lib/repo/teams";
import { aiResponse, aiTask, json, mockFetch, ownerWorkspace } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

let wid: string;
let counter = 0;
beforeAll(async () => {
  wid = await ownerWorkspace();
});

async function email(body: string, subject = "Request", from = "meera@apollohealthacademy.example") {
  const { id } = await tx((d) =>
    insertEmailIfNew(d, wid, {
      source: "gmail", external_id: `ai-${++counter}`, thread_id: null, from_name: "Meera", from_email: from, to_addresses: "bedanta.product@gmail.com",
      cc_addresses: null, subject, snippet: body.slice(0, 50), body, received_at: new Date("2026-09-28T05:00:00Z"), labels: [],
    }),
  );
  return id;
}

function withAi(a: AiAnalysis | string | (() => Response)) {
  return mockFetch({
    "https://api.openai.com/v1/chat/completions": () =>
      typeof a === "function" ? a() : typeof a === "string" ? json({ choices: [{ message: { content: a } }] }) : aiResponse(a),
  });
}

describe("structured output contract", () => {
  it("sends a strict JSON schema to the model", async () => {
    const { calls } = withAi({ classification: "NO_ACTION", confidence: 0.95, reason: "thanks", client: null, tasks: [] });
    await analyzeEmail(wid, await email("Thanks for sharing the report."));
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toEqual(analysisJsonSchema);
    expect(body.messages[1].content).toContain("<email>");
  });

  it("prompt includes team directory with workload and the received date", async () => {
    const { teams, members } = await getDirectory(wid);
    const p = buildUserPrompt({ from_name: "A", from_email: "a@b.c", to_addresses: null, cc_addresses: null, subject: "s", body: "b", received_at: new Date("2026-09-28T05:00:00Z") }, teams, members);
    expect(p).toContain("Email received: 2026-09-28 (Monday)");
    expect(p).toMatch(/Sandeep \(skills: .*available; 0 active tasks\)/);
  });
});

describe("classification routing", () => {
  it("ACTION_REQUIRED with high confidence → Action Required with task drafts", async () => {
    withAi({
      classification: "ACTION_REQUIRED", confidence: 0.94, reason: "Explicit request", client: "Apollo Healthcare Academy",
      tasks: [aiTask({ title: "Update landing page with new course info", suggested_team: "Web/Development", confidence: 0.9 })],
    });
    const id = await email("Please update the landing page with the new course information.");
    const r = await analyzeEmail(wid, id);
    expect(r).toMatchObject({ status: "action_required", classification: "ACTION_REQUIRED" });
    const reqs = await listRequirements(wid, id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ suggested_team_name: "Web/Development", suggested_member_name: "Rahul", status: "pending" });
    // Human-in-the-loop: no task exists until approved.
    expect(await query("select 1 from tasks where email_id = $1", [id])).toHaveLength(0);
  });

  it("a direct question needing an answer is ACTION_REQUIRED", async () => {
    withAi({ classification: "ACTION_REQUIRED", confidence: 0.86, reason: "Question needs a committed answer", client: null, tasks: [aiTask({ title: "Confirm whether campaign can go live next week", suggested_team: "Performance Marketing" })] });
    const r = await analyzeEmail(wid, await email("Can you let me know if the campaign can go live next week?"));
    expect(r.status).toBe("action_required");
  });

  it("NO_ACTION → No Action, and any tasks the model returned are discarded", async () => {
    withAi({ classification: "NO_ACTION", confidence: 0.96, reason: "Acknowledgement", client: null, tasks: [aiTask({ title: "Hallucinated task" })] });
    const id = await email("Thanks for sharing the report.");
    expect((await analyzeEmail(wid, id)).status).toBe("no_action");
    expect(await listRequirements(wid, id)).toHaveLength(0);
  });

  it("UNCERTAIN → Needs Review", async () => {
    withAi({ classification: "UNCERTAIN", confidence: 0.55, reason: "Vague", client: null, tasks: [] });
    expect((await analyzeEmail(wid, await email("Interesting. Let's discuss this tomorrow."))).status).toBe("needs_review");
  });

  it("low-confidence ACTION_REQUIRED (below threshold) → Needs Review, never auto-created", async () => {
    withAi({ classification: "ACTION_REQUIRED", confidence: 0.61, reason: "Maybe", client: null, tasks: [aiTask({ title: "Possibly update deck" })] });
    const id = await email("Might be worth looking at the deck again at some point.");
    expect((await analyzeEmail(wid, id)).status).toBe("needs_review");
    expect(await query("select 1 from tasks where email_id = $1", [id])).toHaveLength(0);
  });

  it("stores AI output, confidence, model and timestamp for evaluation", async () => {
    withAi({ classification: "NO_ACTION", confidence: 0.91, reason: "FYI", client: null, tasks: [] });
    const id = await email("FYI: office closed Friday.");
    await analyzeEmail(wid, id);
    const a = await latestAnalysis(id);
    expect(a).toMatchObject({ model: "gpt-test", classification: "NO_ACTION", confidence: 0.91, prompt_version: expect.any(String) });
    expect(a!.created_at).toBeInstanceOf(Date);
    expect(a!.output?.reason).toBe("FYI");
  });
});

describe("extraction", () => {
  it("extracts deadline, priority, deliverable and multiple tasks", async () => {
    withAi({
      classification: "ACTION_REQUIRED", confidence: 0.9, reason: "Three changes", client: "Northwind Realty",
      tasks: [
        aiTask({ title: "Update homepage CTA", priority: "high", deadline: "2026-09-29", deadline_text: "by tomorrow", deliverable: "Updated CTA", suggested_team: "Web/Development" }),
        aiTask({ title: "Replace phone number", priority: "high", suggested_team: "Web/Development" }),
        aiTask({ title: "Send live URL", priority: "low", dependencies: ["Update homepage CTA"], suggested_team: "Web/Development" }),
      ],
    });
    const id = await email("Please update the homepage CTA, replace the phone number and send me the live URL once done — by tomorrow please.", "Homepage", "karan@northwindrealty.example");
    await analyzeEmail(wid, id);
    const reqs = await listRequirements(wid, id);
    expect(reqs.map((r) => r.title)).toEqual(["Update homepage CTA", "Replace phone number", "Send live URL"]);
    expect(reqs[0]).toMatchObject({ deadline: "2026-09-29", priority: "high", deliverable: "Updated CTA", client: "Northwind Realty" });
    expect(reqs[2]!.dependencies).toEqual(["Update homepage CTA"]);
  });

  it("drops deadlines and clients that are not supported by the email (no hallucination)", async () => {
    const { teams, members } = await getDirectory(wid);
    const n = normalizeAnalysis(
      { classification: "ACTION_REQUIRED", confidence: 0.9, reason: "", client: "Acme Global", tasks: [aiTask({ title: "Write blog", deadline: "2026-10-01", deadline_text: "by Thursday", client: "Acme Global" })] },
      { subject: "Blog", body: "Please write a blog post about our launch.", from_name: "Zoe", from_email: "zoe@zenith.example" },
      teams, members,
    );
    expect(n.tasks[0]).toMatchObject({ deadline: null, deadline_text: null, client: null });
    expect(n.client).toBeNull();
    expect(n.corrections.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects impossible dates", () => {
    const ev = { subject: "", body: "by 31 February", from_name: null, from_email: null };
    expect(deadlineSupported("2026-02-31", "by 31 February", ev)).toBe(false);
    expect(deadlineSupported("2026-03-03", "by 31 February", ev)).toBe(true);
  });

  it("dedupes identical task titles", async () => {
    const { teams, members } = await getDirectory(wid);
    const n = normalizeAnalysis({ classification: "ACTION_REQUIRED", confidence: 0.9, reason: "", client: null, tasks: [aiTask({ title: "Send report" }), aiTask({ title: "send  report" })] }, { subject: "", body: "send report", from_name: null, from_email: null }, teams, members);
    expect(n.tasks).toHaveLength(1);
  });

  it("threshold decision table", () => {
    const t = [{} as never];
    expect(decideEmailStatus({ classification: "ACTION_REQUIRED", confidence: 0.75, tasks: t }, 0.75)).toBe("action_required");
    expect(decideEmailStatus({ classification: "ACTION_REQUIRED", confidence: 0.9, tasks: [] }, 0.75)).toBe("needs_review");
    expect(decideEmailStatus({ classification: "NO_ACTION", confidence: 0.5, tasks: [] }, 0.75)).toBe("needs_review");
    expect(decideEmailStatus({ classification: "NO_ACTION", confidence: 0.8, tasks: [] }, 0.75)).toBe("no_action");
  });
});

describe("invalid AI output", () => {
  it("rejects non-JSON and schema violations", () => {
    expect(() => parseAiOutput("Sure! Here is the analysis")).toThrow(/ai_invalid_output/);
    expect(() => parseAiOutput(JSON.stringify({ classification: "MAYBE", confidence: 2, reason: "", client: null, tasks: [] }))).toThrow(/ai_invalid_output/);
    expect(parseAiOutput('```json\n{"classification":"NO_ACTION","confidence":0.9,"reason":"x","client":null,"tasks":[]}\n```').classification).toBe("NO_ACTION");
  });

  it("retries once, then marks the email as failed with a readable message (email is kept)", async () => {
    const { calls } = withAi("not json at all");
    const id = await email("Please do something.");
    const r = await analyzeEmail(wid, id);
    expect(calls).toHaveLength(2);
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/invalid response/);
    const [row] = await query<{ status: string }>("select status from emails where id = $1", [id]);
    expect(row!.status).toBe("error");
    expect((await latestAnalysis(id))?.error).toBe("ai_invalid_output");
  });

  it("recovers when the retry returns valid JSON", async () => {
    let n = 0;
    withAi(() => (n++ === 0 ? json({ choices: [{ message: { content: "{oops" } }] }) : aiResponse({ classification: "NO_ACTION", confidence: 0.9, reason: "ok", client: null, tasks: [] })));
    expect((await analyzeEmail(wid, await email("Thanks!"))).status).toBe("no_action");
  });

  it("handles provider errors / rate limits without crashing", async () => {
    withAi(() => new Response("{}", { status: 401 }));
    const r = await analyzeEmail(wid, await email("Please send the report."));
    expect(r).toMatchObject({ status: "error", error: expect.stringContaining("AI provider") });
  });

  it("handles AI timeouts", async () => {
    withAi(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const r = await analyzeEmail(wid, await email("Please send the report."));
    expect(r).toMatchObject({ status: "error", error: expect.stringContaining("too long") });
  });
});
