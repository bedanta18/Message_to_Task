"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { approveRequirementAction, ignoreRequirementAction, talkToClientRequirementAction, type ActionState } from "@/app/actions";
import type { Priority } from "@/lib/types";
import { HiddenTaskFields, TaskFields, TeamMemberSelects, type DirMember, type DirTeam, type TaskValues } from "./TaskFields";

export interface RequirementView {
  id: string;
  title: string;
  description: string;
  deliverable: string | null;
  client: string | null;
  priority: Priority;
  deadline: string | null;
  deadline_text: string | null;
  dependencies: string[];
  instructions: string[];
  suggested_team_id: string | null;
  suggested_member_id: string | null;
  suggested_team_name: string | null;
  suggested_member_name: string | null;
  assignment_reason: string | null;
  confidence: number | null;
}

const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : null;

/**
 * AI-generated task preview. Nothing is created until the human clicks
 * “Create Task”; the assignment is only a recommendation until accepted or changed.
 */
export function RequirementCard({
  req, teams, members, heading = "Action Required", lowConfidence = false,
}: {
  req: RequirementView;
  teams: DirTeam[];
  members: DirMember[];
  heading?: string;
  lowConfidence?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(approveRequirementAction, null);
  const [editing, setEditing] = useState(false);
  const [assign, setAssign] = useState<"suggested" | "accepted" | "changing">("suggested");
  const [v, setV] = useState<TaskValues>({
    title: req.title,
    client: req.client ?? "",
    description: req.description,
    deliverable: req.deliverable ?? "",
    priority: req.priority,
    deadline: req.deadline ?? "",
    team_id: req.suggested_team_id ?? "",
    member_id: req.suggested_member_id ?? "",
    dependencies: req.dependencies.join("\n"),
    instructions: req.instructions.join("\n"),
  });
  const update = (p: Partial<TaskValues>) => setV((cur) => ({ ...cur, ...p }));
  const teamName = teams.find((t) => t.id === v.team_id)?.name;
  const memberName = members.find((m) => m.id === v.member_id)?.name;
  const changed = v.team_id !== (req.suggested_team_id ?? "") || v.member_id !== (req.suggested_member_id ?? "");
  const hasSuggestion = Boolean(req.suggested_team_id || req.suggested_member_id);
  const pct = req.confidence != null ? Math.round(req.confidence * 100) : null;

  if (state?.ok && state.id) {
    return (
      <div className="preview">
        <div className="preview-head">
          <span className="badge tone-green">{state.message ?? "Task created"}</span>
          <h3>{v.title}</h3>
          <Link href={`/tasks/${state.id}`}>Open task →</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="preview">
      <input type="hidden" name="requirement_id" value={req.id} />
      <div className="preview-head">
        <div className="spread">
          <span className={`badge ${lowConfidence ? "tone-amber" : "tone-blue"}`}>{heading}</span>
          {pct != null && <span className="small faint">AI confidence <strong style={{ color: pct >= 85 ? "var(--green)" : pct >= 70 ? "var(--a1)" : "var(--amber)" }}>{pct}%</strong></span>}
        </div>
        {!editing && <h3>{v.title}</h3>}
      </div>

      <div className="preview-body stack">
        {editing ? (
          <TaskFields values={v} onChange={update} teams={teams} members={members} showAssignment={false} />
        ) : (
          <>
            <HiddenTaskFields values={v} />
            <dl className="kv">
              <dt>Client</dt><dd>{v.client || <span className="faint">Unknown — not stated in email</span>}</dd>
              <dt>Deliverable</dt><dd>{v.deliverable || <span className="faint">Not stated</span>}</dd>
              <dt>Deadline</dt>
              <dd>
                {v.deadline ? fmtDate(v.deadline) : <span className="faint">No deadline in email</span>}
                {req.deadline_text && v.deadline === (req.deadline ?? "") && <span className="faint small"> · “{req.deadline_text}”</span>}
              </dd>
              <dt>Priority</dt><dd style={{ textTransform: "capitalize" }}>{v.priority}</dd>
              {v.description && (<><dt>Description</dt><dd>{v.description}</dd></>)}
              {req.dependencies.length > 0 && (<><dt>Dependencies</dt><dd><ul className="clean">{req.dependencies.map((d) => <li key={d}>{d}</li>)}</ul></dd></>)}
              {req.instructions.length > 0 && (<><dt>Instructions</dt><dd><ul className="clean">{req.instructions.map((d) => <li key={d}>{d}</li>)}</ul></dd></>)}
            </dl>
          </>
        )}

        {/* Team / assignee are always submitted from here so the choice is explicit. */}
        <input type="hidden" name="team_id" value={v.team_id} />
        <input type="hidden" name="member_id" value={v.member_id} />
        <div className="reco">
          <div className="spread">
            <span className="reco-label">{changed ? "Your assignment" : "AI Recommendation"}</span>
            {assign === "accepted" && !changed && <span className="badge tone-green">Accepted</span>}
          </div>
          {hasSuggestion || v.team_id || v.member_id ? (
            <div>
              <div><span className="faint">Team:</span> <strong>{teamName ?? "Unassigned"}</strong></div>
              <div><span className="faint">Assignee:</span> <strong>{memberName ? `${memberName}${teamName ? ` — ${teamName}` : ""}` : "Unassigned"}</strong></div>
              {!changed && req.assignment_reason && <div className="small muted" style={{ marginTop: 4 }}>{req.assignment_reason}</div>}
            </div>
          ) : (
            <div className="small muted">The AI couldn’t confidently pick a team for this — choose one below.</div>
          )}
          {assign === "changing" || (!hasSuggestion && !v.team_id) ? (
            <div className="form-grid" style={{ marginTop: 4 }}>
              <TeamMemberSelects teams={teams} members={members} teamId={v.team_id} memberId={v.member_id} onChange={(x) => update(x)} />
            </div>
          ) : null}
          <div className="row">
            {hasSuggestion && (
              <button type="button" className="btn btn-sm" disabled={assign === "accepted" && !changed}
                onClick={() => { update({ team_id: req.suggested_team_id ?? "", member_id: req.suggested_member_id ?? "" }); setAssign("accepted"); }}>
                {changed ? "Use AI recommendation" : "Accept Assignment"}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAssign(assign === "changing" ? "suggested" : "changing")}>
              {assign === "changing" ? "Done" : "Change"}
            </button>
          </div>
        </div>

        {state?.error && <div className="alert alert-error">{state.error}</div>}
      </div>

      <div className="preview-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create Task"}</button>
        <button type="submit" className="btn" formAction={talkToClientRequirementAction} formNoValidate disabled={pending}>Talk to Client</button>
        <button type="button" className="btn" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
        <button type="submit" className="btn btn-ghost" formAction={ignoreRequirementAction} formNoValidate disabled={pending}>Ignore</button>
      </div>
    </form>
  );
}
