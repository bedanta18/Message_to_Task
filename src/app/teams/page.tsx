import { deleteMemberAction, deleteTeamAction } from "@/app/actions";
import { ConfirmButton } from "@/components/AutoSubmit";
import { MemberForm, TeamForm } from "@/components/DirectoryForms";
import { Badge, Empty } from "@/components/ui";
import { pageContext } from "@/lib/page";
import { getDirectory } from "@/lib/repo/teams";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const { workspace } = await pageContext();
  const { teams, members } = await getDirectory(workspace.id);
  const teamOpts = teams.map((t) => ({ id: t.id, name: t.name }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p>The AI recommends owners from this directory using team, skills, availability and current workload.</p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2>Team members</h2><span className="sub">{members.length} people</span></div>
        {members.length === 0 ? <Empty>No members yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Team</th><th>Skills</th><th>Active tasks</th><th>Availability</th><th /></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="strong">{m.name}</td>
                    <td>{m.team_name ?? <span className="faint">No team</span>}</td>
                    <td className="small">{m.skills.length ? m.skills.join(", ") : <span className="faint">—</span>}</td>
                    <td>{m.active_tasks}</td>
                    <td><Badge tone={m.availability === "available" ? "green" : m.availability === "busy" ? "amber" : "gray"} dot>{m.availability[0]!.toUpperCase() + m.availability.slice(1)}</Badge></td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <MemberForm member={m} teams={teamOpts} />
                        <form action={deleteMemberAction}>
                          <input type="hidden" name="id" value={m.id} />
                          <ConfirmButton className="btn btn-sm btn-ghost btn-danger" message={`Remove ${m.name}? Their tasks become unassigned.`}>Remove</ConfirmButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-pad" style={{ borderTop: "1px solid var(--border)" }}>
          <h3 style={{ marginBottom: 10 }}>Add a team member</h3>
          <MemberForm teams={teamOpts} />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Teams</h2><span className="sub">{teams.length} teams</span></div>
        <div className="card-pad stack">
          {teams.map((t) => (
            <div key={t.id} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><TeamForm team={t} /></div>
              <form action={deleteTeamAction}>
                <input type="hidden" name="id" value={t.id} />
                <ConfirmButton className="btn btn-sm btn-ghost btn-danger" style={{ height: 34 }} message={`Delete the ${t.name} team? Members and tasks keep existing without a team.`}>Delete</ConfirmButton>
              </form>
            </div>
          ))}
          <div className="divider" />
          <TeamForm />
        </div>
      </section>
    </>
  );
}
