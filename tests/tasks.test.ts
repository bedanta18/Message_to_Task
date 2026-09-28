import { beforeAll, describe, expect, it } from "vitest";
import { persistAnalysis } from "@/lib/analyze";
import { normalizeAnalysis } from "@/lib/ai/normalize";
import { addDaysIso, todayIso } from "@/lib/dates";
import { one, query, tx } from "@/lib/db";
import { insertEmailIfNew, listEmails, listRequirements } from "@/lib/repo/emails";
import {
  assignTask, createManualTask, createTaskFromRequirement, dashboardMetrics, getTask, ignoreEmail, ignoreRequirement, listTasks,
  setTaskStatus, TaskInput, updateTask,
} from "@/lib/repo/tasks";
import { getDirectory, upsertMember } from "@/lib/repo/teams";
import { createDemoWorkspace } from "@/lib/repo/workspace";
import { aiTask, ownerWorkspace } from "./helpers";

let wid: string;
let n = 0;
beforeAll(async () => {
  wid = await ownerWorkspace();
});

/** Creates an analysed email with AI drafts, as the pipeline would. */
async function analysedEmail(titles: { title: string; team?: string; assignee?: string; deadline?: string }[], subject = "Req") {
  const body = `Please do the following. ${titles.map((t) => t.title).join(". ")}. by Friday`;
  const { id } = await tx((d) =>
    insertEmailIfNew(d, wid, { source: "gmail", external_id: `t-${++n}`, thread_id: null, from_name: "Client", from_email: "c@client.example", to_addresses: null, cc_addresses: null, subject, snippet: "", body, received_at: new Date(), labels: [] }),
  );
  const { teams, members } = await getDirectory(wid);
  const analysis = normalizeAnalysis(
    { classification: "ACTION_REQUIRED", confidence: 0.9, reason: "", client: null, tasks: titles.map((t) => aiTask({ title: t.title, suggested_team: t.team ?? null, suggested_assignee: t.assignee ?? null, deadline: t.deadline ?? null, deadline_text: t.deadline ? "by Friday" : null })) },
    { subject, body, from_name: "Client", from_email: "c@client.example" }, teams, members,
  );
  await persistAnalysis(wid, { id }, { model: "test", raw: "{}", analysis, latencyMs: 1, threshold: 0.75 });
  return { emailId: id, reqs: await listRequirements(wid, id) };
}

const input = (p: Record<string, string>) => TaskInput.parse({ priority: "medium", ...p });

describe("task lifecycle", () => {
  it("creates a task from an approved AI draft, accepting the recommendation", async () => {
    const { emailId, reqs } = await analysedEmail([{ title: "Create 5 October creatives", team: "Design", assignee: "Riya" }]);
    const r = reqs[0]!;
    const taskId = await createTaskFromRequirement(wid, r.id, input({ title: r.title, team_id: r.suggested_team_id!, member_id: r.suggested_member_id! }));
    const task = await getTask(wid, taskId);
    expect(task).toMatchObject({ title: "Create 5 October creatives", team_name: "Design", member_name: "Riya", status: "new", recommendation_accepted: true, email_id: emailId });
    expect((await one<{ status: string }>("select status from emails where id = $1", [emailId]))!.status).toBe("processed");
  });

  it("prevents a duplicate task from the same draft", async () => {
    const { reqs } = await analysedEmail([{ title: "Write blog", team: "Content" }]);
    await createTaskFromRequirement(wid, reqs[0]!.id, input({ title: "Write blog" }));
    await expect(createTaskFromRequirement(wid, reqs[0]!.id, input({ title: "Write blog" }))).rejects.toMatchObject({ code: "duplicate" });
    expect(await query("select 1 from tasks where requirement_id = $1", [reqs[0]!.id])).toHaveLength(1);
  });

  it("records a changed (rejected) recommendation", async () => {
    const { reqs } = await analysedEmail([{ title: "Edit reel", team: "Video", assignee: "Sandeep" }]);
    const { teams, members } = await getDirectory(wid);
    const id = await createTaskFromRequirement(wid, reqs[0]!.id, input({ title: "Edit reel", team_id: teams.find((t) => t.name === "Design")!.id, member_id: members.find((m) => m.name === "Riya")!.id }));
    expect((await getTask(wid, id))!.recommendation_accepted).toBe(false);
  });

  it("edits, assigns and moves through New → Assigned → In Progress → Completed", async () => {
    const { reqs } = await analysedEmail([{ title: "Update homepage CTA", team: "Web/Development" }]);
    const id = await createTaskFromRequirement(wid, reqs[0]!.id, input({ title: "Update homepage CTA" }));
    expect((await getTask(wid, id))!.status).toBe("new");

    await updateTask(wid, id, input({ title: "Update homepage CTA to Book a visit", priority: "high", deadline: "2026-10-02", client: "Northwind" }));
    expect(await getTask(wid, id)).toMatchObject({ title: "Update homepage CTA to Book a visit", priority: "high", deadline: "2026-10-02", client: "Northwind" });

    const { teams, members } = await getDirectory(wid);
    await assignTask(wid, id, teams.find((t) => t.name === "Web/Development")!.id, members.find((m) => m.name === "Rahul")!.id);
    expect(await getTask(wid, id)).toMatchObject({ status: "assigned", member_name: "Rahul" });

    await setTaskStatus(wid, id, "in_progress");
    expect((await getTask(wid, id))!.status).toBe("in_progress");
    await setTaskStatus(wid, id, "waiting_for_client");
    await setTaskStatus(wid, id, "completed");
    const done = await getTask(wid, id);
    expect(done!.status).toBe("completed");
    expect(done!.completed_at).toBeInstanceOf(Date);
    await setTaskStatus(wid, id, "in_progress");
    expect((await getTask(wid, id))!.completed_at).toBeNull();
  });

  it("validates task input", () => {
    expect(() => TaskInput.parse({ title: "x", priority: "medium" })).toThrow();
    expect(() => TaskInput.parse({ title: "Valid", priority: "whenever" })).toThrow();
    expect(() => TaskInput.parse({ title: "Valid", priority: "low", deadline: "2026-13-01" })).toThrow();
  });

  it("ignoring drafts / emails never creates tasks", async () => {
    const { emailId, reqs } = await analysedEmail([{ title: "One" }, { title: "Two" }]);
    await ignoreRequirement(wid, reqs[0]!.id);
    expect((await one<{ status: string }>("select status from emails where id = $1", [emailId]))!.status).toBe("action_required");
    await ignoreEmail(wid, emailId);
    expect((await one<{ status: string }>("select status from emails where id = $1", [emailId]))!.status).toBe("ignored");
    expect(await query("select 1 from tasks where email_id = $1", [emailId])).toHaveLength(0);
  });

  it("creates a manual task from a Needs Review email", async () => {
    const { emailId } = await analysedEmail([{ title: "Unclear" }]);
    const id = await createManualTask(wid, emailId, input({ title: "Reply to client about proposal" }));
    expect((await getTask(wid, id))!.email_id).toBe(emailId);
  });

  it("does not leak tasks across workspaces", async () => {
    const other = await ownerWorkspace("someone-else@gmail.com");
    const { reqs } = await analysedEmail([{ title: "Private" }]);
    await expect(createTaskFromRequirement(other, reqs[0]!.id, input({ title: "Private" }))).rejects.toMatchObject({ code: "not_found" });
    expect(await listTasks(other, { status: "all" })).toHaveLength(0);
  });
});

describe("search, filters and dashboard", () => {
  it("filters by status, team, assignee, priority, deadline, overdue; searches client/task/subject/assignee", async () => {
    const { teams, members } = await getDirectory(wid);
    const seo = teams.find((t) => t.name === "SEO")!.id;
    const priya = members.find((m) => m.name === "Priya")!.id;
    const today = todayIso();
    const a = await createManualTask(wid, null, input({ title: "Meta tags for Greenleaf", client: "Greenleaf Organics", priority: "urgent", deadline: today, team_id: seo, member_id: priya }));
    const b = await createManualTask(wid, null, input({ title: "Old overdue thing", priority: "low", deadline: addDaysIso(today, -2) }));
    const { reqs } = await analysedEmail([{ title: "Subject search target" }], "Zebra subject line");
    const c = await createTaskFromRequirement(wid, reqs[0]!.id, input({ title: "Subject search target" }));

    const ids = async (f: Parameters<typeof listTasks>[1]) => (await listTasks(wid, f)).map((t) => t.id);
    expect(await ids({ q: "greenleaf" })).toEqual([a]);
    expect(await ids({ q: "Priya" })).toContain(a);
    expect(await ids({ q: "zebra" })).toEqual([c]);
    expect(await ids({ team: seo })).toEqual([a]);
    expect(await ids({ member: priya })).toEqual([a]);
    expect(await ids({ priority: "urgent" })).toContain(a);
    expect(await ids({ due: "today" })).toContain(a);
    expect(await ids({ due: "overdue" })).toContain(b);
    expect(await ids({ due: "overdue" })).not.toContain(a);
    expect(await ids({ member: "unassigned" })).toContain(b);

    await setTaskStatus(wid, b, "completed");
    expect(await ids({ due: "overdue" })).not.toContain(b);
    expect(await ids({})).not.toContain(b); // default = open tasks
    expect(await ids({ status: "completed" })).toContain(b);

    const m = await dashboardMetrics(wid);
    expect(m.due_today).toBeGreaterThanOrEqual(1);
    expect(m.completed).toBeGreaterThanOrEqual(1);
    expect(m.emails_synced).toBeGreaterThan(0);
  });

  it("team members can be edited, with active task counts", async () => {
    const { members } = await getDirectory(wid);
    const priya = members.find((m) => m.name === "Priya")!;
    expect(priya.active_tasks).toBeGreaterThanOrEqual(1);
    await upsertMember(wid, { id: priya.id, name: "Priya S", teamId: priya.team_id, skills: "Meta Tags, schema", availability: "busy" });
    const after = (await getDirectory(wid)).members.find((m) => m.id === priya.id)!;
    expect(after).toMatchObject({ name: "Priya S", skills: ["meta tags", "schema"], availability: "busy" });
  });
});

describe("demo workspace", () => {
  it("seeds labelled demo data covering every queue", async () => {
    const demo = await createDemoWorkspace();
    const emails = await listEmails(demo, { status: "all" });
    expect(emails.length).toBeGreaterThanOrEqual(10);
    expect(emails.every((e) => e.is_demo)).toBe(true);
    const statuses = new Set(emails.map((e) => e.status));
    for (const s of ["action_required", "needs_review", "no_action", "processed"]) expect(statuses).toContain(s);
    const m = await dashboardMetrics(demo);
    expect(m).toMatchObject({ overdue: 1, due_today: 1, completed: 1, unassigned: 1 });
    const multi = emails.find((e) => e.external_id === "demo-website-update")!;
    expect(await listRequirements(demo, multi.id)).toHaveLength(3);
  });
});
