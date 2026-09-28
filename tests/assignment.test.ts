import { describe, expect, it } from "vitest";
import { keywordTeam, matchMember, matchTeam, recommendAssignment } from "@/lib/assignment";
import type { MemberRow, TeamRow } from "@/lib/types";

const teams: TeamRow[] = ["Content", "Design", "SEO", "Video", "Web/Development", "Performance Marketing", "Social Media", "Marketing Strategy"].map((name, i) => ({ id: `t${i}`, name, description: "" }));
const team = (n: string) => teams.find((t) => t.name === n)!;
const m = (name: string, teamName: string, extra: Partial<MemberRow> = {}): MemberRow => ({
  id: `m-${name}`, name, email: null, team_id: team(teamName).id, team_name: teamName, skills: [], availability: "available", active_tasks: 0, ...extra,
});
const members = [
  m("Riya", "Design", { skills: ["social creatives"] }),
  m("Neel", "Design", { active_tasks: 4 }),
  m("Sandeep", "Video", { skills: ["video editing"] }),
  m("Priya", "SEO"),
  m("Rahul", "Web/Development"),
  m("Arjun", "Content", { availability: "away" }),
];

describe("assignment recommendation", () => {
  it("video task → Video team, Sandeep", () => {
    const r = recommendAssignment({ text: "Create a 60-second anniversary video", suggestedTeam: "Video", suggestedAssignee: "Sandeep", aiReason: "Task requires video production and Sandeep is assigned to the Video team." }, teams, members);
    expect(r).toMatchObject({ teamName: "Video", memberName: "Sandeep" });
    expect(r.reason).toContain("video production");
  });

  it("picks the least-loaded member when the AI names only a team", () => {
    const r = recommendAssignment({ text: "Design 3 banners", suggestedTeam: "Design", suggestedAssignee: null, aiReason: null }, teams, [m("Riya", "Design", { active_tasks: 5 }), m("Neel", "Design", { active_tasks: 1 })]);
    expect(r.memberName).toBe("Neel");
    expect(r.reason).toMatch(/least-loaded/);
  });

  it("never recommends someone who is away", () => {
    const r = recommendAssignment({ text: "Write a blog post", suggestedTeam: "Content", suggestedAssignee: "Arjun", aiReason: null }, teams, members);
    expect(r.teamName).toBe("Content");
    expect(r.memberId).toBeNull();
    expect(r.reason).toMatch(/assign manually/);
  });

  it("ignores assignees and teams that don't exist", () => {
    const r = recommendAssignment({ text: "Update meta descriptions", suggestedTeam: "Growth Hacking", suggestedAssignee: "Bob", aiReason: null }, teams, members);
    expect(r).toMatchObject({ teamName: "SEO", memberName: "Priya" }); // keyword fallback
  });

  it("rejects an AI assignee from the wrong team", () => {
    const r = recommendAssignment({ text: "Fix the landing page form", suggestedTeam: "Web/Development", suggestedAssignee: "Riya", aiReason: null }, teams, members);
    expect(r.memberName).toBe("Rahul");
  });

  it("returns nothing when there is no signal (unclear ownership)", () => {
    expect(recommendAssignment({ text: "Let's catch up", suggestedTeam: null, suggestedAssignee: null, aiReason: null }, teams, members).teamId).toBeNull();
  });

  it("fuzzy matching", () => {
    expect(matchTeam("web development", teams)?.name).toBe("Web/Development");
    expect(matchTeam("seo", teams)?.name).toBe("SEO");
    expect(matchMember("Riya — Design", members)?.name).toBe("Riya");
    expect(keywordTeam("Need 5 Instagram creatives", teams)?.name).toBe("Design");
  });
});
