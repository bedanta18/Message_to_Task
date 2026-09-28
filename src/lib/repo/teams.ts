import { one, query, type Db } from "../db";
import { DEFAULT_MEMBERS, DEFAULT_TEAMS, type Availability, type MemberRow, type TeamRow } from "../types";

export async function listTeams(workspaceId: string, d?: Db): Promise<TeamRow[]> {
  return (d ?? { query }).query<TeamRow>("select id, name, description from teams where workspace_id = $1 order by name", [workspaceId]);
}

export async function listMembers(workspaceId: string, d?: Db): Promise<MemberRow[]> {
  return (d ?? { query }).query<MemberRow>(
    `select m.id, m.name, m.email, m.team_id, t.name as team_name, m.skills, m.availability,
            (select count(*)::int from tasks k
              where k.member_id = m.id and k.status not in ('completed', 'cancelled')) as active_tasks
       from members m left join teams t on t.id = m.team_id
      where m.workspace_id = $1
      order by m.name`,
    [workspaceId],
  );
}

export async function getDirectory(workspaceId: string, d?: Db) {
  const teams = await listTeams(workspaceId, d);
  const members = await listMembers(workspaceId, d);
  return { teams, members };
}

export async function seedDirectory(d: Db, workspaceId: string): Promise<void> {
  for (const t of DEFAULT_TEAMS) {
    await d.query("insert into teams (workspace_id, name, description) values ($1, $2, $3) on conflict do nothing", [workspaceId, t.name, t.description]);
  }
  const teams = await d.query<{ id: string; name: string }>("select id, name from teams where workspace_id = $1", [workspaceId]);
  for (const m of DEFAULT_MEMBERS) {
    const teamId = teams.find((t) => t.name === m.team)?.id ?? null;
    await d.query("insert into members (workspace_id, team_id, name, skills) values ($1, $2, $3, $4)", [workspaceId, teamId, m.name, [...m.skills]]);
  }
}

const cleanSkills = (skills: string[] | string): string[] =>
  (Array.isArray(skills) ? skills : skills.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

export async function upsertTeam(workspaceId: string, input: { id?: string; name: string; description?: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("Team name is required");
  if (input.id) {
    await query("update teams set name = $3, description = $4 where id = $1 and workspace_id = $2", [input.id, workspaceId, name, input.description ?? ""]);
  } else {
    await query("insert into teams (workspace_id, name, description) values ($1, $2, $3)", [workspaceId, name, input.description ?? ""]);
  }
}

export async function deleteTeam(workspaceId: string, id: string): Promise<void> {
  await query("delete from teams where id = $1 and workspace_id = $2", [id, workspaceId]);
}

export async function upsertMember(
  workspaceId: string,
  input: { id?: string; name: string; teamId: string | null; skills: string[] | string; availability: Availability; email?: string | null },
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("Member name is required");
  if (input.teamId) {
    const ok = await one("select 1 from teams where id = $1 and workspace_id = $2", [input.teamId, workspaceId]);
    if (!ok) throw new Error("Unknown team");
  }
  const params = [workspaceId, name, input.teamId, cleanSkills(input.skills), input.availability, input.email?.trim() || null];
  if (input.id) {
    await query(
      "update members set name = $2, team_id = $3, skills = $4, availability = $5, email = $6 where id = $7 and workspace_id = $1",
      [...params, input.id],
    );
  } else {
    await query("insert into members (workspace_id, name, team_id, skills, availability, email) values ($1, $2, $3, $4, $5, $6)", params);
  }
}

export async function deleteMember(workspaceId: string, id: string): Promise<void> {
  await query("delete from members where id = $1 and workspace_id = $2", [id, workspaceId]);
}
