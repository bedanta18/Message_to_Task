"use client";

import { useActionState, useState } from "react";
import { createManualTaskAction, updateTaskAction, type ActionState } from "@/app/actions";
import { TaskFields, type DirMember, type DirTeam, type TaskValues } from "./TaskFields";

/** Edit an existing task (mode="edit") or create one manually, optionally linked to an email. */
export function TaskForm({
  mode, taskId, emailId, initial, teams, members, submitLabel,
}: {
  mode: "edit" | "create";
  taskId?: string;
  emailId?: string;
  initial: TaskValues;
  teams: DirTeam[];
  members: DirMember[];
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(mode === "edit" ? updateTaskAction : createManualTaskAction, null);
  const [v, setV] = useState<TaskValues>(initial);
  return (
    <form action={action} className="stack">
      {taskId && <input type="hidden" name="task_id" value={taskId} />}
      {emailId && <input type="hidden" name="email_id" value={emailId} />}
      <input type="hidden" name="team_id" value={v.team_id} />
      <input type="hidden" name="member_id" value={v.member_id} />
      <TaskFields values={v} onChange={(p) => setV((c) => ({ ...c, ...p }))} teams={teams} members={members} />
      {state?.error && <div className="alert alert-error">{state.error}</div>}
      {state?.ok && state.message && <div className="alert alert-success">{state.message}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : (submitLabel ?? (mode === "edit" ? "Save changes" : "Create Task"))}</button>
      </div>
    </form>
  );
}
