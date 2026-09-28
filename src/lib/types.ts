export const TASK_STATUSES = ["new", "assigned", "in_progress", "waiting_for_client", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In Progress",
  waiting_for_client: "Waiting for Client",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const OPEN_STATUSES: TaskStatus[] = ["new", "assigned", "in_progress", "waiting_for_client"];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CLASSIFICATIONS = ["ACTION_REQUIRED", "NO_ACTION", "UNCERTAIN"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const EMAIL_STATUSES = ["pending", "action_required", "needs_review", "no_action", "ignored", "processed", "error"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  pending: "Pending analysis",
  action_required: "Action Required",
  needs_review: "Needs Review",
  no_action: "No Action",
  ignored: "Ignored",
  processed: "Tasks created",
  error: "Analysis failed",
};

export const AVAILABILITY = ["available", "busy", "away"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const DEFAULT_TEAMS = [
  { name: "Content", description: "Copywriting, blogs, email and website copy" },
  { name: "Design", description: "Social creatives, banners, brand and UI design" },
  { name: "Social Media", description: "Posting calendars, community and social campaigns" },
  { name: "SEO", description: "Metadata, keywords, technical and on-page SEO" },
  { name: "Performance Marketing", description: "Paid ads, budgets, campaign reporting" },
  { name: "Web/Development", description: "Website, landing pages, forms and tracking" },
  { name: "Video", description: "Video production, editing and motion" },
  { name: "Marketing Strategy", description: "Plans, strategy, client reviews and reporting" },
] as const;

export const DEFAULT_MEMBERS = [
  { name: "Riya", team: "Design", skills: ["social creatives", "banners", "brand design", "figma"] },
  { name: "Arjun", team: "Content", skills: ["copywriting", "blogs", "email copy", "scripts"] },
  { name: "Sandeep", team: "Video", skills: ["video editing", "motion graphics", "reels"] },
  { name: "Priya", team: "SEO", skills: ["meta tags", "keyword research", "technical seo"] },
  { name: "Amit", team: "Performance Marketing", skills: ["google ads", "meta ads", "reporting", "budgets"] },
  { name: "Rahul", team: "Web/Development", skills: ["landing pages", "wordpress", "next.js", "tracking"] },
] as const;

export interface TeamRow {
  id: string;
  name: string;
  description: string;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  team_id: string | null;
  team_name: string | null;
  skills: string[];
  availability: Availability;
  active_tasks: number;
}

export interface EmailRow {
  id: string;
  workspace_id: string;
  source: "gmail" | "demo";
  external_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string;
  snippet: string;
  body: string;
  received_at: Date;
  labels: string[];
  is_demo: boolean;
  status: EmailStatus;
  error: string | null;
}

export interface RequirementRow {
  id: string;
  email_id: string;
  analysis_id: string | null;
  idx: number;
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
  status: "pending" | "approved" | "ignored";
  task_id: string | null;
}

export interface TaskRow {
  id: string;
  email_id: string | null;
  requirement_id: string | null;
  title: string;
  description: string;
  deliverable: string | null;
  client: string | null;
  priority: Priority;
  deadline: string | null;
  team_id: string | null;
  team_name: string | null;
  member_id: string | null;
  member_name: string | null;
  status: TaskStatus;
  ai_confidence: number | null;
  suggested_team_id: string | null;
  suggested_member_id: string | null;
  recommendation_accepted: boolean | null;
  dependencies: string[];
  instructions: string[];
  is_demo: boolean;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  email_subject: string | null;
}

export interface SettingsRow {
  workspace_id: string;
  sync_mode: "recent" | "label" | "both";
  gmail_query: string;
  label_filter: string;
  max_emails: number;
  sync_frequency: "manual" | "hourly" | "every_6_hours" | "daily";
  ai_model: string | null;
  confidence_threshold: number;
  default_priority: Priority;
  default_status: "new" | "assigned";
}
