import fs from "node:fs";
import path from "node:path";
import type { AiAnalysis, AiTask } from "./ai/schema";
import { addDaysIso, todayIso } from "./dates";

/**
 * DEMO DATA — synthetic client emails with pre-computed AI analyses so visitors
 * (and the owner, before Gmail is connected) can try the full review → approve →
 * track workflow without an AI key. Dates are generated relative to "today" so the
 * demo never goes stale. Each demo email is flagged is_demo and shown with a badge.
 */

export interface DemoEmail {
  key: string;
  from_name: string;
  from_email: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  hoursAgo: number;
  analysis: AiAnalysis;
  /** Optionally pre-approve drafts so the task board isn't empty. */
  approve?: { status: "new" | "assigned" | "in_progress" | "waiting_for_client" | "completed" };
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const say = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`));

function t(p: Partial<AiTask> & Pick<AiTask, "title" | "description">): AiTask {
  return {
    deliverable: null, client: null, priority: "medium", deadline: null, deadline_text: null, dependencies: [], instructions: [],
    suggested_team: null, suggested_assignee: null, assignment_reason: null, confidence: 0.9, ...p,
  };
}

function buildCuratedDemoEmails(today = todayIso()): DemoEmail[] {
  const d2 = addDaysIso(today, 2);
  const d4 = addDaysIso(today, 4);
  const d10 = addDaysIso(today, 10);
  const tomorrow = addDaysIso(today, 1);
  const me = "bedanta.product@gmail.com";

  return [
    {
      key: "demo-social-creatives",
      from_name: "Meera Iyer", from_email: "meera@apollohealthacademy.example", to: me,
      subject: "October campaign — social creatives",
      body: `Hi team,\n\nPlease create five social media creatives for our October campaign. We need the first draft by ${say(d2)}.\n\nUse the new brand palette we shared last week and keep the course dates visible on every creative.\n\nThanks,\nMeera\nApollo Healthcare Academy`,
      hoursAgo: 3,
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.93, reason: "Direct request to produce five creatives with a stated first-draft deadline.", client: "Apollo Healthcare Academy",
        tasks: [t({
          title: "Create 5 October campaign creatives", description: "Create five social media creatives for the October campaign and share the first draft.",
          deliverable: "5 social media creatives (first draft)", client: "Apollo Healthcare Academy", deadline: d2, deadline_text: `by ${say(d2)}`,
          instructions: ["Use the new brand palette shared last week", "Keep course dates visible on every creative"],
          suggested_team: "Design", suggested_assignee: "Riya", assignment_reason: "Social creatives are Design work and Riya specialises in social creatives.", confidence: 0.93,
        })],
      },
    },
    {
      key: "demo-website-update",
      from_name: "Karan Shah", from_email: "karan@northwindrealty.example", to: me, cc: "ops@northwindrealty.example",
      subject: "Homepage changes",
      body: `Hi Bedanta,\n\nPlease update the homepage CTA to "Book a site visit", replace the phone number with +91 98765 43210 and send me the live URL once done.\n\nRegards,\nKaran — Northwind Realty`,
      hoursAgo: 5,
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.9, reason: "Three explicit website change requests.", client: "Northwind Realty",
        tasks: [
          t({ title: "Update homepage CTA to “Book a site visit”", description: "Change the homepage call-to-action text to “Book a site visit”.", deliverable: "Updated homepage CTA", client: "Northwind Realty", suggested_team: "Web/Development", assignment_reason: "Homepage change is Web/Development work.", confidence: 0.92 }),
          t({ title: "Replace phone number on website", description: "Replace the phone number on the website with +91 98765 43210.", deliverable: "Updated phone number", client: "Northwind Realty", suggested_team: "Web/Development", instructions: ["New number: +91 98765 43210"], assignment_reason: "Site content change is Web/Development work.", confidence: 0.9 }),
          t({ title: "Send live URL to Karan", description: "Once the homepage changes are live, send Karan the live URL.", deliverable: "Live URL shared with client", client: "Northwind Realty", dependencies: ["Update homepage CTA", "Replace phone number"], priority: "low", suggested_team: "Web/Development", assignment_reason: "Follows the web changes.", confidence: 0.85 }),
        ],
      },
    },
    {
      key: "demo-seo-metadata",
      from_name: "Anita Rao", from_email: "anita@greenleaforganics.example", to: me,
      subject: "Meta titles for product pages",
      body: `Hello,\n\nCould you update the meta titles and meta descriptions for our 12 new product pages? Please have it done by ${say(d4)} — we're sending a newsletter after that.\n\nThe product list is in the shared sheet.\n\nAnita\nGreenleaf Organics`,
      hoursAgo: 26,
      approve: { status: "assigned" },
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.91, reason: "Request for SEO metadata updates with a deadline.", client: "Greenleaf Organics",
        tasks: [t({ title: "Update SEO metadata for 12 product pages", description: "Write and update meta titles and meta descriptions for the 12 new product pages.", deliverable: "Meta titles + descriptions for 12 pages", client: "Greenleaf Organics", deadline: d4, deadline_text: `by ${say(d4)}`, dependencies: ["Product list in the shared sheet"], suggested_team: "SEO", suggested_assignee: "Priya", assignment_reason: "Meta tags are SEO work and Priya owns meta tags.", confidence: 0.91 })],
      },
    },
    {
      key: "demo-anniversary-video",
      from_name: "Vikram Sethi", from_email: "vikram@zenithmotors.example", to: me,
      subject: "Anniversary video",
      body: `Hi,\n\nWe'd like a 60-second anniversary video celebrating 25 years of Zenith Motors. Final cut needed by ${say(d10)}. We'll send the archive photos this week.\n\nBest,\nVikram`,
      hoursAgo: 50,
      approve: { status: "in_progress" },
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.94, reason: "Clear video production request with a deadline.", client: "Zenith Motors",
        tasks: [t({ title: "Produce 60-second anniversary video", description: "Create a 60-second video celebrating 25 years of Zenith Motors.", deliverable: "60-second anniversary video (final cut)", client: "Zenith Motors", deadline: d10, deadline_text: `by ${say(d10)}`, dependencies: ["Archive photos from client"], priority: "medium", suggested_team: "Video", suggested_assignee: "Sandeep", assignment_reason: "Task requires video production and Sandeep is on the Video team.", confidence: 0.94 })],
      },
    },
    {
      key: "demo-campaign-report",
      from_name: "Neha Kapoor", from_email: "neha@brightpathedu.example", to: me,
      subject: "URGENT: September ads report",
      body: `Hi,\n\nOur leadership review got moved up. Can you send the September Meta ads performance report by tomorrow? Cost per lead and total leads are the key numbers.\n\nThanks!\nNeha, Brightpath Education`,
      hoursAgo: 2,
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.88, reason: "Urgent request for a campaign report.", client: "Brightpath Education",
        tasks: [t({ title: "Send September Meta ads performance report", description: "Prepare the September Meta ads performance report highlighting cost per lead and total leads.", deliverable: "September Meta ads report", client: "Brightpath Education", deadline: tomorrow, deadline_text: "by tomorrow", priority: "urgent", instructions: ["Highlight cost per lead and total leads"], suggested_team: "Performance Marketing", suggested_assignee: "Amit", assignment_reason: "Ads reporting is Performance Marketing work; Amit handles reporting.", confidence: 0.88 })],
      },
    },
    {
      key: "demo-landing-page",
      from_name: "Meera Iyer", from_email: "meera@apollohealthacademy.example", to: me,
      subject: "Landing page — new course info",
      body: `Hi,\n\nPlease update the landing page with the new course information (attached brochure). The fee and start date have changed.\n\nMeera`,
      hoursAgo: 20,
      analysis: {
        classification: "ACTION_REQUIRED", confidence: 0.89, reason: "Request to update landing page content.", client: "Apollo Healthcare Academy",
        tasks: [t({ title: "Update landing page with new course information", description: "Update the landing page with the new course fee and start date from the brochure.", deliverable: "Updated landing page", client: "Apollo Healthcare Academy", dependencies: ["Course brochure (attached)"], instructions: ["Fee and start date have changed"], suggested_team: "Web/Development", suggested_assignee: "Rahul", assignment_reason: "Landing page updates are Web/Development work; Rahul builds landing pages.", confidence: 0.89 })],
      },
    },
    {
      key: "demo-follow-up",
      from_name: "Rohit Menon", from_email: "rohit@lumenfitness.example", to: me,
      subject: "Checking in",
      body: `Hey Bedanta,\n\nJust checking in on the proposal we talked about last month. Any thoughts?\n\nRohit\nLumen Fitness`,
      hoursAgo: 8,
      analysis: {
        classification: "UNCERTAIN", confidence: 0.61, reason: "A soft follow-up; it may need a reply or a proposal, but no specific work is requested.", client: "Lumen Fitness",
        tasks: [t({ title: "Reply to Lumen Fitness about the proposal", description: "Follow up with Rohit on the status of the proposal discussed last month.", client: "Lumen Fitness", priority: "low", suggested_team: "Marketing Strategy", assignment_reason: "Client proposal follow-ups sit with Marketing Strategy.", confidence: 0.55 })],
      },
    },
    {
      key: "demo-lets-discuss",
      from_name: "Sana Qureshi", from_email: "sana@orbitfoods.example", to: me,
      subject: "Re: Q4 ideas",
      body: `Interesting. Let's discuss this tomorrow.\n\nSana`,
      hoursAgo: 12,
      analysis: { classification: "UNCERTAIN", confidence: 0.52, reason: "Conversational; it is unclear what work, if any, is being requested.", client: null, tasks: [] },
    },
    {
      key: "demo-thanks",
      from_name: "Anita Rao", from_email: "anita@greenleaforganics.example", to: me,
      subject: "Re: Monthly report",
      body: `Thanks for sharing the report. Looks good!\n\nAnita`,
      hoursAgo: 30,
      analysis: { classification: "NO_ACTION", confidence: 0.97, reason: "Acknowledgement only.", client: "Greenleaf Organics", tasks: [] },
    },
    {
      key: "demo-meeting-confirmation",
      from_name: "Vikram Sethi", from_email: "vikram@zenithmotors.example", to: me,
      subject: "Call confirmed",
      body: `Confirming our call on Thursday at 4 pm. Talk then.\n\nVikram`,
      hoursAgo: 28,
      analysis: { classification: "NO_ACTION", confidence: 0.9, reason: "Meeting confirmation; nothing to produce.", client: "Zenith Motors", tasks: [] },
    },
    {
      key: "demo-approval",
      from_name: "Karan Shah", from_email: "karan@northwindrealty.example", to: me,
      subject: "Re: Brochure v3",
      body: `The revised brochure looks great — approved. No further changes needed from our side.\n\nKaran`,
      hoursAgo: 70,
      analysis: { classification: "NO_ACTION", confidence: 0.93, reason: "Final approval with no further changes requested.", client: "Northwind Realty", tasks: [] },
    },
  ];
}

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function demoTeam(subject: string): string {
  const text = subject.toLowerCase();
  if (/seo|keyword|meta|ranking|analytics|utm/.test(text)) return "SEO";
  if (/video|thumbnail|reel|photograph|shoot|subtitles/.test(text)) return "Video";
  if (/google ads|facebook ad|linkedin ad|paid|campaign budget|lead generation/.test(text)) return "Performance Marketing";
  if (/blog|content|newsletter|article|copy|script/.test(text)) return "Content";
  if (/website|landing page|webpage|homepage|form|migration/.test(text)) return "Web/Development";
  if (/social|instagram|linkedin|facebook|influencer/.test(text)) return "Social Media";
  if (/design|creative|brochure|logo|banner|presentation|dashboard/.test(text)) return "Design";
  return "Marketing Strategy";
}

function buildCsvDemoEmails(): DemoEmail[] | null {
  const file = path.join(process.cwd(), "data", "message_to_task_dummy_emails_100.csv");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = lines.slice(1).map(parseCsvRow).filter((row) => row.length >= 3 && row[0]);
  const now = Date.now();

  return rows.map(([fromEmail, subject, body], index) => {
    const nonAction = /\b(approved|for your reference|let's discuss)\b/i.test(body);
    const needsReview = /\b(let's discuss|checking in|any thoughts)\b/i.test(body);
    const classification = needsReview ? "UNCERTAIN" : nonAction ? "NO_ACTION" : "ACTION_REQUIRED";
    const team = demoTeam(subject);
    const multiTask = index === 1;
    const analysis: AiAnalysis = {
      classification,
      confidence: needsReview ? 0.61 : nonAction ? 0.94 : 0.86,
      reason: needsReview ? "The email is conversational and may need a response, but the requested work is unclear." : nonAction ? "The email is an approval, reference, or discussion note without a new deliverable." : "The email contains a direct request for agency work.",
      client: null,
      tasks: nonAction && !needsReview ? [] : Array.from({ length: multiTask ? 3 : 1 }, (_, taskIndex) => t({
        title: taskIndex === 0 ? subject : `${subject} - part ${taskIndex + 1}`,
        description: body,
        deliverable: subject,
        suggested_team: team,
        suggested_assignee: multiTask ? "Rahul" : null,
        assignment_reason: `This request appears to be ${team} work based on its subject.`,
        confidence: 0.86,
      })),
    };
    return {
      key: multiTask ? "demo-website-update" : `csv-${fromEmail}-${index}`,
      from_name: fromEmail.split("@")[0] ?? "Client",
      from_email: fromEmail,
      to: "bedanta.product@gmail.com",
      subject,
      body,
      hoursAgo: index * 3 + 1,
      analysis,
      approve: multiTask ? { status: "assigned" } : undefined,
    };
  });
}

export function buildDemoEmails(today = todayIso()): DemoEmail[] {
  return buildCsvDemoEmails() ?? buildCuratedDemoEmails(today);
}

/** Extra manually-created demo tasks so the dashboard shows due-today / overdue / completed states. */
export function buildDemoManualTasks(today = todayIso()) {
  return [
    { title: "Share Q3 ad spend summary", client: "Brightpath Education", team: "Performance Marketing", member: "Amit", status: "in_progress", priority: "high", deadline: addDaysIso(today, -1) },
    { title: "Send revised pitch deck", client: "Orbit Foods", team: "Marketing Strategy", member: null, status: "new", priority: "high", deadline: today },
    { title: "Publish September blog post", client: "Greenleaf Organics", team: "Content", member: "Arjun", status: "completed", priority: "medium", deadline: addDaysIso(today, -3) },
  ] as const;
}
