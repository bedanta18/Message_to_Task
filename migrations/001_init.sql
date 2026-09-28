-- Agency Action Hub — initial schema.
-- Every row is scoped to a workspace so multi-user / multi-agency support can be
-- added later without reshaping data. Today there is one "owner" workspace
-- (Bedanta) plus short-lived, self-contained "demo" workspaces for visitors.

create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('owner', 'demo')),
  owner_email   text unique,
  name          text not null default 'My agency',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- One Gmail connection per workspace. Tokens are AES-256-GCM encrypted by the app.
create table if not exists gmail_accounts (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null unique references workspaces(id) on delete cascade,
  email                    text not null,
  refresh_token_enc        text,
  access_token_enc         text,
  access_token_expires_at  timestamptz,
  scope                    text not null,
  status                   text not null default 'connected' check (status in ('connected', 'expired', 'revoked')),
  last_sync_at             timestamptz,
  last_error               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists settings (
  workspace_id          uuid primary key references workspaces(id) on delete cascade,
  sync_mode             text not null default 'recent' check (sync_mode in ('recent', 'label', 'both')),
  gmail_query           text not null default 'in:inbox newer_than:7d -from:me -category:promotions -category:social -category:updates -category:forums',
  label_filter          text not null default 'AI-Task-Inbox',
  max_emails            integer not null default 25 check (max_emails between 1 and 50),
  sync_frequency        text not null default 'manual' check (sync_frequency in ('manual', 'hourly', 'every_6_hours', 'daily')),
  ai_model              text,
  confidence_threshold  numeric(3, 2) not null default 0.75 check (confidence_threshold between 0 and 1),
  default_priority      text not null default 'medium' check (default_priority in ('low', 'medium', 'high', 'urgent')),
  default_status        text not null default 'new' check (default_status in ('new', 'assigned')),
  updated_at            timestamptz not null default now()
);

create table if not exists teams (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  description   text not null default '',
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  team_id       uuid references teams(id) on delete set null,
  name          text not null,
  email         text,
  skills        text[] not null default '{}',
  availability  text not null default 'available' check (availability in ('available', 'busy', 'away')),
  created_at    timestamptz not null default now()
);

-- Source messages. source + external_id (the Gmail message ID) is the dedupe key:
-- re-syncing the same email never creates a second row, requirement, or task.
create table if not exists emails (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  source        text not null default 'gmail' check (source in ('gmail', 'demo')),
  external_id   text not null,
  thread_id     text,
  from_name     text,
  from_email    text,
  to_addresses  text,
  cc_addresses  text,
  subject       text not null default '',
  snippet       text not null default '',
  body          text not null default '',
  received_at   timestamptz not null,
  labels        text[] not null default '{}',
  is_demo       boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending', 'action_required', 'needs_review', 'no_action', 'ignored', 'processed', 'error')),
  error         text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, source, external_id)
);
create index if not exists emails_ws_status_idx on emails (workspace_id, status, received_at desc);

-- Every AI run is stored verbatim (validated output + raw text) for auditing and
-- future evaluation (precision / recall / acceptance-rate dashboards).
create table if not exists ai_analyses (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  email_id        uuid not null references emails(id) on delete cascade,
  model           text not null,
  prompt_version  text not null,
  classification  text check (classification in ('ACTION_REQUIRED', 'NO_ACTION', 'UNCERTAIN')),
  confidence      numeric(4, 3),
  output          jsonb,
  raw_output      text,
  latency_ms      integer,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists ai_analyses_email_idx on ai_analyses (email_id, created_at desc);

-- AI-extracted task drafts awaiting human approval.
create table if not exists requirements (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces(id) on delete cascade,
  email_id             uuid not null references emails(id) on delete cascade,
  analysis_id          uuid references ai_analyses(id) on delete set null,
  idx                  integer not null default 0,
  title                text not null,
  description          text not null default '',
  deliverable          text,
  client               text,
  priority             text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  deadline             date,
  deadline_text        text,
  dependencies         jsonb not null default '[]',
  instructions         jsonb not null default '[]',
  suggested_team_id    uuid references teams(id) on delete set null,
  suggested_member_id  uuid references members(id) on delete set null,
  assignment_reason    text,
  confidence           numeric(4, 3),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'ignored')),
  created_at           timestamptz not null default now(),
  unique (email_id, idx)
);

create table if not exists tasks (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,
  email_id                 uuid references emails(id) on delete set null,
  requirement_id           uuid unique references requirements(id) on delete set null,
  title                    text not null,
  description              text not null default '',
  deliverable              text,
  client                   text,
  priority                 text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  deadline                 date,
  team_id                  uuid references teams(id) on delete set null,
  member_id                uuid references members(id) on delete set null,
  status                   text not null default 'new'
                           check (status in ('new', 'assigned', 'in_progress', 'waiting_for_client', 'completed', 'cancelled')),
  ai_confidence            numeric(4, 3),
  suggested_team_id        uuid references teams(id) on delete set null,
  suggested_member_id      uuid references members(id) on delete set null,
  recommendation_accepted  boolean,
  dependencies             jsonb not null default '[]',
  instructions             jsonb not null default '[]',
  is_demo                  boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz
);
create index if not exists tasks_ws_status_idx on tasks (workspace_id, status);
create index if not exists tasks_member_idx on tasks (member_id) where status not in ('completed', 'cancelled');

-- First-party product analytics. Only ids / counts / enums — never email content.
create table if not exists events (
  id            bigserial primary key,
  workspace_id  uuid references workspaces(id) on delete cascade,
  name          text not null,
  props         jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists events_ws_name_idx on events (workspace_id, name);
