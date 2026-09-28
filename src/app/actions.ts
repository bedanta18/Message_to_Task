"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrent } from "@/lib/current";
import { toUserMessage } from "@/lib/errors";
import { SettingsInput, updateSettings } from "@/lib/repo/settings";
import {
  assignTask, createManualTask, createTaskFromRequirement, deleteTask, ignoreEmail, ignoreRequirement, setTaskStatus, TaskInput, updateTask,
} from "@/lib/repo/tasks";
import { deleteMember, deleteTeam, upsertMember, upsertTeam } from "@/lib/repo/teams";
import { AVAILABILITY, TASK_STATUSES, type Availability, type TaskStatus } from "@/lib/types";

export type ActionState = { ok?: boolean; error?: string; message?: string; id?: string } | null;

function fail(e: unknown): ActionState {
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { message: string }[] }).issues;
    return { ok: false, error: issues.map((i) => i.message).join(" · ") };
  }
  if (!(e instanceof Error && "userMessage" in e)) console.error(e);
  return { ok: false, error: toUserMessage(e) };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

function taskFromForm(fd: FormData) {
  return TaskInput.parse({
    title: str(fd, "title"),
    description: str(fd, "description") ?? "",
    deliverable: str(fd, "deliverable"),
    client: str(fd, "client"),
    priority: str(fd, "priority"),
    deadline: str(fd, "deadline"),
    team_id: str(fd, "team_id"),
    member_id: str(fd, "member_id"),
    dependencies: str(fd, "dependencies"),
    instructions: str(fd, "instructions"),
  });
}

function refreshAll() {
  revalidatePath("/", "layout");
}

// ── Requirements / emails (human approval) ─────────────────────────────────

export async function approveRequirementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { workspace } = await requireCurrent();
    const id = await createTaskFromRequirement(workspace.id, String(fd.get("requirement_id")), taskFromForm(fd));
    refreshAll();
    return { ok: true, id, message: "Task created." };
  } catch (e) {
    return fail(e);
  }
}

export async function ignoreRequirementAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await ignoreRequirement(workspace.id, String(fd.get("requirement_id")));
  refreshAll();
}

export async function ignoreEmailAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await ignoreEmail(workspace.id, String(fd.get("email_id")));
  refreshAll();
  const back = str(fd, "back");
  if (back) redirect(back);
}

export async function createManualTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { workspace } = await requireCurrent();
    const emailId = str(fd, "email_id") || null;
    id = await createManualTask(workspace.id, emailId, taskFromForm(fd));
    refreshAll();
  } catch (e) {
    return fail(e);
  }
  redirect(`/tasks/${id}?created=1`);
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export async function updateTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { workspace } = await requireCurrent();
    await updateTask(workspace.id, String(fd.get("task_id")), taskFromForm(fd));
    refreshAll();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function setTaskStatusAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  const status = String(fd.get("status")) as TaskStatus;
  if (!TASK_STATUSES.includes(status)) return;
  await setTaskStatus(workspace.id, String(fd.get("task_id")), status);
  refreshAll();
}

export async function assignTaskAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await assignTask(workspace.id, String(fd.get("task_id")), str(fd, "team_id") || null, str(fd, "member_id") || null);
  refreshAll();
}

export async function deleteTaskAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await deleteTask(workspace.id, String(fd.get("task_id")));
  refreshAll();
  redirect("/tasks?deleted=1");
}

// ── Teams ──────────────────────────────────────────────────────────────────

export async function saveTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { workspace } = await requireCurrent();
    await upsertTeam(workspace.id, { id: str(fd, "id") || undefined, name: str(fd, "name") ?? "", description: str(fd, "description") ?? "" });
    refreshAll();
    return { ok: true, message: "Team saved." };
  } catch (e) {
    const msg = e instanceof Error && /duplicate|unique/i.test(e.message) ? "A team with that name already exists." : undefined;
    return msg ? { ok: false, error: msg } : fail(e);
  }
}

export async function deleteTeamAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await deleteTeam(workspace.id, String(fd.get("id")));
  refreshAll();
}

export async function saveMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { workspace } = await requireCurrent();
    const availability = (str(fd, "availability") ?? "available") as Availability;
    await upsertMember(workspace.id, {
      id: str(fd, "id") || undefined,
      name: str(fd, "name") ?? "",
      teamId: str(fd, "team_id") || null,
      skills: str(fd, "skills") ?? "",
      availability: AVAILABILITY.includes(availability) ? availability : "available",
      email: str(fd, "email"),
    });
    refreshAll();
    return { ok: true, message: "Member saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteMemberAction(fd: FormData): Promise<void> {
  const { workspace } = await requireCurrent();
  await deleteMember(workspace.id, String(fd.get("id")));
  refreshAll();
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { workspace } = await requireCurrent();
    const input = SettingsInput.parse(Object.fromEntries(fd.entries()));
    await updateSettings(workspace.id, input);
    refreshAll();
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return fail(e);
  }
}
