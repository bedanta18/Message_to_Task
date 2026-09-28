import type { MemberRow, TeamRow } from "./types";

/**
 * Deterministic, explainable assignment recommendation. The LLM proposes a team
 * and (optionally) a person; this validates the proposal against the real
 * directory and falls back to skill + workload when the proposal is missing or
 * invalid. The result is only a recommendation — a human always approves it.
 */
export interface AssignmentInput {
  text: string; // title + description + deliverable, used for keyword fallback
  suggestedTeam: string | null;
  suggestedAssignee: string | null;
  aiReason: string | null;
}

export interface Recommendation {
  teamId: string | null;
  teamName: string | null;
  memberId: string | null;
  memberName: string | null;
  reason: string | null;
}

const TEAM_KEYWORDS: Record<string, RegExp> = {
  Video: /\b(video|reel|reels|youtube|footage|edit(ing)? the (video|clip)|motion|animation|shoot|testimonial video)\b/i,
  Design: /\b(creative|creatives|banner|poster|design|logo|mock-?up|carousel|visual|graphic|thumbnail|brochure|flyer|artwork)\b/i,
  SEO: /\b(seo|meta (titles?|descriptions?|tags?)|metadata|keyword|backlink|search ranking|sitemap|schema markup|alt text)\b/i,
  "Web/Development": /\b(website|web ?page|landing page|homepage|home page|cta|button|form|url|link|page speed|wordpress|pixel|tracking code|bug|404|phone number on the site)\b/i,
  "Performance Marketing": /\b(ads?|ad campaign|google ads|meta ads|facebook ads|ppc|cpc|cpl|roas|budget|campaign (report|performance)|go live|leads report|retarget)\b/i,
  "Social Media": /\b(instagram|facebook post|linkedin post|posting|content calendar|social (media )?(post|calendar|schedule)|stories|hashtag)\b/i,
  Content: /\b(copy|copywriting|blog|article|caption|newsletter|email copy|script|content|write|proofread|press release)\b/i,
  "Marketing Strategy": /\b(strategy|plan|proposal|report|review meeting|quarterly|roadmap|audit|pitch|presentation|deck)\b/i,
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function matchTeam(name: string | null, teams: TeamRow[]): TeamRow | null {
  if (!name) return null;
  const n = norm(name);
  return (
    teams.find((t) => norm(t.name) === n) ??
    teams.find((t) => norm(t.name).replace(/[^a-z]/g, "") === n.replace(/[^a-z]/g, "")) ??
    teams.find((t) => norm(t.name).split("/").some((part) => part === n)) ??
    null
  );
}

export function matchMember(name: string | null, members: MemberRow[]): MemberRow | null {
  if (!name) return null;
  // Accept "Riya", "Riya — Design", "riya (design)".
  const n = norm(name.split(/[—–(-]/)[0] ?? name);
  if (!n) return null;
  return members.find((m) => norm(m.name) === n) ?? members.find((m) => norm(m.name).split(" ")[0] === n.split(" ")[0]) ?? null;
}

export function keywordTeam(text: string, teams: TeamRow[]): TeamRow | null {
  for (const [teamName, re] of Object.entries(TEAM_KEYWORDS)) {
    if (re.test(text)) {
      const t = matchTeam(teamName, teams);
      if (t) return t;
    }
  }
  return null;
}

function skillOverlap(m: MemberRow, text: string): number {
  const t = text.toLowerCase();
  return m.skills.filter((s) => s && t.includes(s.toLowerCase())).length;
}

export function pickMember(team: TeamRow, members: MemberRow[], text: string): MemberRow | null {
  const candidates = members.filter((m) => m.team_id === team.id && m.availability !== "away");
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) =>
      Number(a.availability === "busy") - Number(b.availability === "busy") ||
      a.active_tasks - b.active_tasks ||
      skillOverlap(b, text) - skillOverlap(a, text) ||
      a.name.localeCompare(b.name),
  )[0]!;
}

const plural = (n: number) => `${n} active task${n === 1 ? "" : "s"}`;

export function recommendAssignment(input: AssignmentInput, teams: TeamRow[], members: MemberRow[]): Recommendation {
  let team = matchTeam(input.suggestedTeam, teams);
  let teamFromKeywords = false;
  if (!team) {
    team = keywordTeam(input.text, teams);
    teamFromKeywords = Boolean(team);
  }

  const aiMember = matchMember(input.suggestedAssignee, members);
  // Accept the AI's person only if they exist, are not away, and fit the team.
  if (aiMember && aiMember.availability !== "away" && (!team || aiMember.team_id === team.id)) {
    const memberTeam = team ?? teams.find((t) => t.id === aiMember.team_id) ?? null;
    return {
      teamId: memberTeam?.id ?? null,
      teamName: memberTeam?.name ?? null,
      memberId: aiMember.id,
      memberName: aiMember.name,
      reason: input.aiReason ?? `${aiMember.name} is on the ${memberTeam?.name ?? "relevant"} team (${plural(aiMember.active_tasks)}).`,
    };
  }

  if (!team) return { teamId: null, teamName: null, memberId: null, memberName: null, reason: null };

  const member = pickMember(team, members, input.text);
  const teamWhy = teamFromKeywords
    ? `The request looks like ${team.name} work.`
    : (input.aiReason?.trim() || `The request matches the ${team.name} team.`);
  const memberWhy = member
    ? ` ${member.name} is the ${member.availability === "busy" ? "least-loaded" : "least-loaded available"} ${team.name} member (${plural(member.active_tasks)}).`
    : ` No available member on ${team.name} — assign manually.`;
  return {
    teamId: team.id,
    teamName: team.name,
    memberId: member?.id ?? null,
    memberName: member?.name ?? null,
    reason: (teamWhy + memberWhy).trim(),
  };
}
