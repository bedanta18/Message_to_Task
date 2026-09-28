"use client";

import { PRIORITIES, type Priority } from "@/lib/types";

export interface DirTeam { id: string; name: string }
export interface DirMember { id: string; name: string; team_id: string | null; availability: string; active_tasks: number }

export interface TaskValues {
  title: string;
  client: string;
  description: string;
  deliverable: string;
  priority: Priority;
  deadline: string;
  team_id: string;
  member_id: string;
  dependencies: string;
  instructions: string;
}

export function TeamMemberSelects({
  teams, members, teamId, memberId, onChange,
}: {
  teams: DirTeam[];
  members: DirMember[];
  teamId: string;
  memberId: string;
  onChange: (v: { team_id: string; member_id: string }) => void;
}) {
  const visible = teamId ? members.filter((m) => m.team_id === teamId) : members;
  return (
    <>
      <label className="field">
        Team
        <select
          value={teamId}
          onChange={(e) => {
            const t = e.target.value;
            const keep = members.find((m) => m.id === memberId && (!t || m.team_id === t));
            onChange({ team_id: t, member_id: keep ? memberId : "" });
          }}
        >
          <option value="">Unassigned team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">
        Assignee
        <select
          value={memberId}
          onChange={(e) => {
            const m = members.find((x) => x.id === e.target.value);
            onChange({ member_id: e.target.value, team_id: m?.team_id ?? teamId });
          }}
        >
          <option value="">Unassigned</option>
          {visible.map((m) => (
            <option key={m.id} value={m.id} disabled={m.availability === "away"}>
              {m.name}
              {!teamId && m.team_id ? ` — ${teams.find((t) => t.id === m.team_id)?.name ?? ""}` : ""}
              {` (${m.active_tasks} active${m.availability !== "available" ? `, ${m.availability}` : ""})`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Editable task fields. Field names match the server actions' FormData contract. */
export function TaskFields({
  values, onChange, teams, members, showAssignment = true,
}: {
  values: TaskValues;
  onChange: (v: Partial<TaskValues>) => void;
  teams: DirTeam[];
  members: DirMember[];
  showAssignment?: boolean;
}) {
  const bind = (k: keyof TaskValues) => ({
    name: k,
    value: values[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ [k]: e.target.value } as Partial<TaskValues>),
  });
  return (
    <div className="form-grid">
      <label className="field span-2">Task title<input type="text" required minLength={3} maxLength={160} {...bind("title")} /></label>
      <label className="field">Client<input type="text" placeholder="Unknown" {...bind("client")} /></label>
      <label className="field">Deliverable<input type="text" placeholder="Not stated" {...bind("deliverable")} /></label>
      <label className="field">Priority
        <select {...bind("priority")}>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}</select>
      </label>
      <label className="field">Deadline<input type="date" {...bind("deadline")} /></label>
      {showAssignment && (
        <TeamMemberSelects teams={teams} members={members} teamId={values.team_id} memberId={values.member_id} onChange={(v) => onChange(v)} />
      )}
      <label className="field span-2">Description<textarea rows={3} {...bind("description")} /></label>
      <label className="field">Dependencies <span className="field-hint">one per line</span><textarea rows={2} {...bind("dependencies")} /></label>
      <label className="field">Important instructions <span className="field-hint">one per line</span><textarea rows={2} {...bind("instructions")} /></label>
    </div>
  );
}

/** Hidden mirror of the task values (except team/member, which the caller submits explicitly). */
export function HiddenTaskFields({ values }: { values: TaskValues }) {
  const keys = (Object.keys(values) as (keyof TaskValues)[]).filter((k) => k !== "team_id" && k !== "member_id");
  return (
    <>
      {keys.map((k) => <input key={k} type="hidden" name={k} value={values[k]} />)}
    </>
  );
}
