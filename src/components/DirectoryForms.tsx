"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveMemberAction, saveTeamAction, saveSettingsAction, type ActionState } from "@/app/actions";

function Status({ state }: { state: ActionState }) {
  if (state?.error) return <span className="small" style={{ color: "var(--red)" }}>{state.error}</span>;
  if (state?.ok) return <span className="small" style={{ color: "var(--green)" }}>{state.message ?? "Saved."}</span>;
  return null;
}

export function TeamForm({ team }: { team?: { id: string; name: string; description: string } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTeamAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !team) ref.current?.reset();
  }, [state, team]);
  return (
    <form ref={ref} action={action} className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
      {team && <input type="hidden" name="id" value={team.id} />}
      <label className="field" style={{ flex: "0 0 180px" }}>{team ? "Name" : "New team"}<input type="text" name="name" defaultValue={team?.name} required maxLength={60} /></label>
      <label className="field" style={{ flex: 1 }}>Description<input type="text" name="description" defaultValue={team?.description} maxLength={200} /></label>
      <button className="btn btn-sm" disabled={pending} style={{ height: 34 }}>{team ? "Save" : "Add team"}</button>
      <Status state={state} />
    </form>
  );
}

export function MemberForm({
  member, teams,
}: {
  member?: { id: string; name: string; email: string | null; team_id: string | null; skills: string[]; availability: string };
  teams: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMemberAction, null);
  const [open, setOpen] = useState(!member);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !member) ref.current?.reset();
    if (state?.ok && member) setOpen(false);
  }, [state, member]);
  if (member && !open) return <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Edit</button>;
  return (
    <form ref={ref} action={action} className="stack" style={{ minWidth: 280 }}>
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className="form-grid">
        <label className="field">Name<input type="text" name="name" defaultValue={member?.name} required maxLength={80} /></label>
        <label className="field">Team
          <select name="team_id" defaultValue={member?.team_id ?? ""}>
            <option value="">No team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="field">Skills <span className="field-hint">comma-separated</span><input type="text" name="skills" defaultValue={member?.skills.join(", ")} placeholder="e.g. reels, motion graphics" /></label>
        <label className="field">Availability
          <select name="availability" defaultValue={member?.availability ?? "available"}>
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="away">Away (never recommended)</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn btn-sm btn-primary" disabled={pending}>{member ? "Save member" : "Add member"}</button>
        {member && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>}
        <Status state={state} />
      </div>
    </form>
  );
}

export function SettingsForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettingsAction, null);
  return (
    <form action={action} className="stack-lg">
      {children}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}
