/**
 * Offline evaluation of the AI pipeline against the synthetic dataset in
 * data/eval/emails.json, using the real configured model (needs OPENAI_API_KEY).
 * No database required and no real emails involved.
 *
 *   npm run eval:ai            # all emails
 *   npm run eval:ai -- e06 e15 # a subset
 *
 * Reports: classification accuracy, action-detection precision / recall / F1,
 * task-count, deadline, priority, team and assignee accuracy.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { chatJson } from "../src/lib/ai/client";
import { normalizeAnalysis, parseAiOutput } from "../src/lib/ai/normalize";
import { buildUserPrompt, SYSTEM_PROMPT } from "../src/lib/ai/prompt";
import { env } from "../src/lib/env";
import { DEFAULT_MEMBERS, DEFAULT_TEAMS, type MemberRow, type TeamRow } from "../src/lib/types";
import { parseAddress, stripQuoted } from "../src/lib/google/gmail";

interface Item {
  id: string;
  tags: string[];
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  expected: {
    classification: string | string[];
    tasks?: [number, number];
    deadlines?: (string | null)[];
    priority?: string[];
    team?: string;
    assignee?: string;
    client?: string;
  };
}

const dataset = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/eval/emails.json"), "utf8")) as { received_at: string; emails: Item[] };
const teams: TeamRow[] = DEFAULT_TEAMS.map((t, i) => ({ id: `team-${i}`, name: t.name, description: t.description }));
const members: MemberRow[] = DEFAULT_MEMBERS.map((m, i) => ({
  id: `member-${i}`, name: m.name, email: null, team_id: teams.find((t) => t.name === m.team)!.id, team_name: m.team,
  skills: [...m.skills], availability: "available", active_tasks: 0,
}));

const oneOf = (v: string | null | undefined, exp: string | string[]) => (Array.isArray(exp) ? exp : [exp]).includes(v ?? "");

async function main() {
  if (!env.aiConfigured) {
    console.error("OPENAI_API_KEY is not set. Add it to .env.local to run the evaluation.");
    process.exit(1);
  }
  const only = process.argv.slice(2);
  const items = dataset.emails.filter((e) => !only.length || only.includes(e.id));
  const received = new Date(dataset.received_at);
  const now = received; // evaluate as if "today" is the received date
  const tally = { cls: [0, 0], tasks: [0, 0], deadline: [0, 0], priority: [0, 0], team: [0, 0], assignee: [0, 0], client: [0, 0] };
  let tp = 0, fp = 0, fn = 0;
  const failures: string[] = [];

  console.log(`Evaluating ${items.length} emails with ${env.aiModel} via ${env.aiBaseUrl}\n`);
  for (const e of items) {
    const from = parseAddress(e.from);
    const email = { from_name: from.name, from_email: from.email, to_addresses: e.to, cc_addresses: e.cc ?? null, subject: e.subject, body: stripQuoted(e.body), received_at: received };
    let line = `${e.id.padEnd(4)} `;
    try {
      const res = await chatJson({ model: env.aiModel, system: SYSTEM_PROMPT, user: buildUserPrompt(email, teams, members, now) });
      const a = normalizeAnalysis(parseAiOutput(res.content), email, teams, members);
      const x = e.expected;

      const clsOk = oneOf(a.classification, x.classification);
      tally.cls[1]++; if (clsOk) tally.cls[0]++;
      const expAction = x.classification === "ACTION_REQUIRED";
      const gotAction = a.classification === "ACTION_REQUIRED";
      if (!Array.isArray(x.classification)) {
        if (gotAction && expAction) tp++;
        else if (gotAction && !expAction) fp++;
        else if (!gotAction && expAction) fn++;
      }
      line += `${clsOk ? "✓" : "✗"} ${a.classification.padEnd(15)} ${String(Math.round(a.confidence * 100)).padStart(3)}%  tasks=${a.tasks.length}`;
      if (!clsOk) failures.push(`${e.id}: expected ${x.classification}, got ${a.classification} — ${a.reason}`);

      if (x.tasks) {
        const ok = a.tasks.length >= x.tasks[0] && a.tasks.length <= x.tasks[1];
        tally.tasks[1]++; if (ok) tally.tasks[0]++;
        if (!ok) failures.push(`${e.id}: expected ${x.tasks.join("-")} tasks, got ${a.tasks.length}`);
      }
      if (x.deadlines && a.tasks.length) {
        const got = a.tasks.map((t) => t.deadline);
        const ok = x.deadlines.every((d, i) => (got[i] ?? null) === d);
        tally.deadline[1]++; if (ok) tally.deadline[0]++;
        if (!ok) failures.push(`${e.id}: deadlines expected ${JSON.stringify(x.deadlines)}, got ${JSON.stringify(got)}`);
      }
      const t0 = a.tasks[0];
      if (x.priority && t0) { tally.priority[1]++; if (x.priority.includes(t0.priority)) tally.priority[0]++; else failures.push(`${e.id}: priority ${t0.priority}, expected ${x.priority.join("/")}`); }
      if (x.team && t0) { tally.team[1]++; if (t0.recommendation.teamName === x.team) tally.team[0]++; else failures.push(`${e.id}: team ${t0.recommendation.teamName}, expected ${x.team}`); }
      if (x.assignee && t0) { tally.assignee[1]++; if (t0.recommendation.memberName === x.assignee) tally.assignee[0]++; else failures.push(`${e.id}: assignee ${t0.recommendation.memberName}, expected ${x.assignee}`); }
      if (x.client && t0) { tally.client[1]++; if ((t0.client ?? "").toLowerCase().includes(x.client.toLowerCase())) tally.client[0]++; else failures.push(`${e.id}: client ${t0.client}, expected ~${x.client}`); }
      line += `  ${res.latencyMs}ms`;
    } catch (err) {
      line += `ERROR ${err instanceof Error ? err.message : err}`;
      failures.push(`${e.id}: ${err instanceof Error ? err.message : err}`);
    }
    console.log(line);
  }

  const pct = ([a, b]: number[]) => (b ? `${Math.round((a! / b) * 100)}% (${a}/${b})` : "n/a");
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  console.log(`
Classification accuracy   ${pct(tally.cls)}
Action detection          precision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%  F1 ${(f1 * 100).toFixed(0)}%
Task count in range       ${pct(tally.tasks)}
Deadline extraction       ${pct(tally.deadline)}
Priority                  ${pct(tally.priority)}
Team recommendation       ${pct(tally.team)}
Assignee recommendation   ${pct(tally.assignee)}
Client extraction         ${pct(tally.client)}`);
  if (failures.length) console.log(`\nMisses:\n  ${failures.join("\n  ")}`);
}

main();
