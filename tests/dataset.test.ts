import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatJson } from "@/lib/ai/client";
import { normalizeAnalysis, parseAiOutput } from "@/lib/ai/normalize";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { parseAddress, stripQuoted } from "@/lib/google/gmail";
import { DEFAULT_MEMBERS, DEFAULT_TEAMS, type MemberRow, type TeamRow } from "@/lib/types";

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/eval/emails.json"), "utf8")) as {
  received_at: string;
  emails: { id: string; tags: string[]; from: string; to: string; cc?: string; subject: string; body: string; expected: { classification: string | string[]; tasks?: [number, number] } }[];
};

describe("synthetic AI dataset", () => {
  it("has at least 20 emails covering every required category", () => {
    expect(data.emails.length).toBeGreaterThanOrEqual(20);
    const tags = new Set(data.emails.flatMap((e) => e.tags));
    for (const t of ["actionable", "non_actionable", "ambiguous", "multi_task", "explicit_deadline", "relative_deadline", "no_deadline", "unclear_ownership", "multiple_recipients", "urgent"]) {
      expect(tags, `missing category ${t}`).toContain(t);
    }
    expect(new Set(data.emails.map((e) => e.id)).size).toBe(data.emails.length);
  });

  it("uses only synthetic addresses (no real inboxes besides the owner as recipient)", () => {
    for (const e of data.emails) {
      expect(parseAddress(e.from).email).toMatch(/\.example$/);
    }
  });

  it("quoted reply history is stripped before analysis", () => {
    const e = data.emails.find((x) => x.tags.includes("reply_thread"))!;
    expect(stripQuoted(e.body)).not.toContain("Sharing the banner draft");
  });
});

/**
 * Live model check against the dataset. Opt-in (costs tokens):
 *   LIVE_AI_TEST=1 OPENAI_API_KEY=sk-... npx vitest run tests/dataset.test.ts
 * For a full metrics report use: npm run eval:ai
 */
describe.skipIf(!process.env.LIVE_AI_TEST)("live AI classification (opt-in)", () => {
  const teams: TeamRow[] = DEFAULT_TEAMS.map((t, i) => ({ id: `t${i}`, name: t.name, description: t.description }));
  const members: MemberRow[] = DEFAULT_MEMBERS.map((m, i) => ({ id: `m${i}`, name: m.name, email: null, team_id: teams.find((t) => t.name === m.team)!.id, team_name: m.team, skills: [...m.skills], availability: "available", active_tasks: 0 }));
  for (const e of data.emails) {
    it(`${e.id} → ${e.expected.classification}`, async () => {
      const from = parseAddress(e.from);
      const email = { from_name: from.name, from_email: from.email, to_addresses: e.to, cc_addresses: e.cc ?? null, subject: e.subject, body: stripQuoted(e.body), received_at: new Date(data.received_at) };
      const res = await chatJson({ model: process.env.AI_MODEL ?? "gpt-4.1-mini", system: SYSTEM_PROMPT, user: buildUserPrompt(email, teams, members, new Date(data.received_at)) });
      const a = normalizeAnalysis(parseAiOutput(res.content), email, teams, members);
      const allowed = Array.isArray(e.expected.classification) ? e.expected.classification : [e.expected.classification];
      expect(allowed).toContain(a.classification);
    }, 60_000);
  }
});
