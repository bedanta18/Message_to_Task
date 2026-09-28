# Agency Action Hub

**Turn client emails into actionable tasks.**
A micro-tool for [aipmbedanta.com](https://www.aipmbedanta.com/) by Bedanta Gogoi, served at
`https://www.aipmbedanta.com/tools/agency-action-hub`.

Client requirements arrive every day by email, and some of them never become tasks. Agency Action Hub reads Gmail (read-only), finds the emails that need work, extracts structured tasks, and recommends which team or person should own each one. **You approve every task.**

```
Gmail (read-only OAuth) → fetch recent mail → AI: detect → extract → recommend
      → Action Required / Needs Review queues → YOU review, edit, approve, assign
      → Task board: New → Assigned → In Progress → Waiting for Client → Completed
```

The principle is that AI detects, extracts, and recommends, while a human reviews, approves, and assigns. The system never creates a task by itself.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start (local)](#quick-start-local)
- [Environment variables](#environment-variables)
- [Connecting bedanta.product@gmail.com](#connecting-bedantaproductgmailcom)
- [Testing](#testing)
- [Deployment & website integration](#deployment--website-integration)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

Detailed guides: [Google OAuth setup](docs/GOOGLE_OAUTH_SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md) · [Architecture](docs/ARCHITECTURE.md)

---

## Features

| Area | What it does |
|---|---|
| **Gmail connection** | Google OAuth 2.0 (Authorization Code with PKCE and `state`), scope `gmail.readonly` only. Refresh tokens are AES-256-GCM encrypted at rest and refreshed automatically. There is no password field anywhere. |
| **Sync Emails** | Fetches the latest 25 messages by default (50 max) using a configurable Gmail query. Modes: **Recent**, **Label only** (e.g. `AI-Task-Inbox`), or **Both** (labelled *and* recent). The default is deliberately narrow: `in:inbox newer_than:7d -from:me -category:promotions -category:social -category:updates -category:forums`. |
| **AI action detection** | Classifies each email as `ACTION_REQUIRED`, `NO_ACTION` or `UNCERTAIN`, with a confidence score. |
| **Requirement extraction** | Extracts client, title, description, deliverable, priority, deadline (relative dates resolved against the received date), dependencies, instructions, team, assignee and confidence. Strict JSON Schema output is validated with Zod on the server. |
| **Anti-hallucination guards** | A deadline is kept only if its wording appears in the email, and a client only if the name appears in the email or sender domain. Team and assignee names must exist in the directory. Every dropped field is recorded and shown as a "Safety check". |
| **Task decomposition** | One email can produce several independent tasks (e.g. *update CTA · replace phone number · send live URL*). |
| **Assignment recommendation** | The AI suggests a team and person. The backend validates the suggestion and falls back to skills plus workload (least-loaded available member). Members marked **away** are never recommended. The UI offers **Accept Assignment** or **Change**. |
| **Human-in-the-loop** | Each actionable email shows a task preview with **Create Task / Edit / Ignore**. Anything below the confidence threshold goes to **Needs Review** ("AI is only 61% confident…") with **Review / Ignore**. |
| **Dashboard** | Shows Emails synced, Action required, Unassigned, Due today, Overdue and Completed, plus the Action Required, Needs Review, Task Queue and Overdue lists. |
| **Tasks** | List and board views. Search by client, task, email subject or assignee. Filter by status, team, assignee, priority and deadline (overdue / today / 7 days / none). Every task keeps its original email: subject, sender, date, body and Gmail message ID. |
| **Teams** | Editable teams and members (skills, availability, live active-task count). Seeded with Riya, Arjun, Sandeep, Priya, Amit and Rahul across 8 teams. |
| **Settings** | Gmail account, sync mode/query/label/size/frequency, AI model, confidence threshold, task defaults, AI quality signals and product event counts. |
| **Duplicate protection** | The Gmail message ID is a unique key, so re-syncing never re-imports, re-analyses or re-creates tasks. Approving the same draft twice is rejected. |
| **Demo mode** | Visitors (or you, before connecting Gmail) get an isolated demo workspace with 11 synthetic, clearly labelled emails and tasks. It needs no AI key. |
| **Analytics** | A first-party `events` table records ids, counts and enums only. No email content ever reaches analytics. |

## Architecture

```
www.aipmbedanta.com (Astro, static, Vercel)
  └─ vercel.json rewrite: /tools/agency-action-hub/*  ──►  agency-action-hub.vercel.app (this app)
                                                            Next.js 16 (App Router, basePath)
                                                            ├─ Server Components + Server Actions (UI, mutations)
                                                            ├─ Route handlers: OAuth, sync, analyse, cron
                                                            ├─ Gmail REST API (read-only) ──► Google
                                                            ├─ OpenAI-compatible Chat Completions ──► AI provider
                                                            └─ Postgres (Supabase) — PGlite locally/tests
```

**Why a separate Next.js app instead of adding it to the Astro site?** I inspected the live site: it is static Astro served by Vercel (`bom1`). OAuth callbacks, encrypted token storage, background AI calls and a database all need a server runtime, and adding them to the Astro site would mean switching it to SSR and touching its build. A separate Vercel project plus **one rewrite rule** serves the tool on the same domain, with the same cookies, the same OAuth redirect host and zero changes to existing pages. The UI reuses the site's design tokens (Syne + Manrope, `#3457D1` / `#0083A8`, `#FAFBFF` background).

Key directories:

```
src/app/                 pages (Dashboard, Inbox, Tasks, Teams, Settings) + server actions + API routes
src/lib/google/          oauth.ts (PKCE/state, refresh, revoke) · gmail.ts (read-only client, parsing) · account.ts (encrypted tokens)
src/lib/ai/              schema.ts (JSON Schema + Zod) · prompt.ts · client.ts (OpenAI-compatible) · normalize.ts (validation + guards)
src/lib/analyze.ts       detect → extract → recommend → persist (never creates tasks)
src/lib/assignment.ts    deterministic, explainable team/member recommendation
src/lib/sync.ts          Gmail sync with dedupe, time budget, 401 refresh
src/lib/repo/            data access (all queries scoped by workspace_id)
migrations/              SQL schema (auto-applied on cold start; also `npm run db:migrate`)
data/eval/emails.json    22 synthetic client emails for AI evaluation
tests/                   Vitest suites (OAuth, Gmail, AI, assignment, tasks, dataset)
```

## Quick start (local)

Requirements: Node 20+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill `.env.local`. The minimum to run the demo is `TOKEN_ENCRYPTION_KEY` and `SESSION_SECRET`:

```bash
npm run gen:key
```

Use the output for `TOKEN_ENCRYPTION_KEY`, and any 32+ character random string for `SESSION_SECRET`. Leave `DATABASE_URL` empty to use embedded Postgres (PGlite) stored in `./.data/`, so no database install is needed.

```bash
npm run dev
```

Open **http://localhost:3000/tools/agency-action-hub**. Note the base path: `/` on its own returns 404.

- Click **Explore the demo** to try the full review → approve → track flow straight away.
- To use real Gmail, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `OPENAI_API_KEY` (see [Google OAuth setup](docs/GOOGLE_OAUTH_SETUP.md)), then click **Connect Gmail**.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | for Gmail | OAuth 2.0 *Web application* client |
| `GOOGLE_CLIENT_SECRET` | for Gmail | server-only |
| `GOOGLE_REDIRECT_URI` | for Gmail | must match the OAuth client exactly: `…/tools/agency-action-hub/api/auth/google/callback` |
| `OPENAI_API_KEY` | for AI | any OpenAI-compatible provider |
| `AI_BASE_URL` | optional | default `https://api.openai.com/v1` |
| `AI_MODEL` | optional | default `gpt-4.1-mini`; can be overridden per workspace in Settings |
| `AI_RESPONSE_FORMAT` | optional | `json_schema` (default, strict) or `json_object` for providers without schema support |
| `DATABASE_URL` | prod | Supabase pooled connection string; empty locally means PGlite |
| `NEXT_PUBLIC_APP_URL` | yes | public URL **including** base path, no trailing slash |
| `TOKEN_ENCRYPTION_KEY` | yes | 32 bytes, base64 (`npm run gen:key`) |
| `SESSION_SECRET` | yes | 32+ chars; signs session and OAuth-state cookies |
| `ALLOWED_EMAILS` | yes | comma-separated. Default `bedanta.product@gmail.com`. Other Google accounts are refused and their grant is revoked. |
| `CRON_SECRET` | for cron | Vercel Cron sends it as a Bearer token |
| `APP_TIMEZONE` | optional | default `Asia/Kolkata` (used for "due today" / "overdue") |
| `AUTO_MIGRATE` | optional | set `false` to disable migrate-on-cold-start |

## Connecting bedanta.product@gmail.com

1. Complete [Google OAuth setup](docs/GOOGLE_OAUTH_SETUP.md). Add `bedanta.product@gmail.com` as a **Test user** on the consent screen.
2. Open the tool and click **Connect Gmail**. Google shows its own consent screen; sign in as `bedanta.product@gmail.com`.
3. Approve "**View your email messages and settings**" (read-only). Because the app isn't Google-verified, Google warns that it is unverified. For a personal tool, choose *Advanced → Go to Agency Action Hub (unsafe)*.
4. You land back on the Dashboard showing **Gmail connected: bedanta.product@gmail.com**.
5. Click **Sync Emails**. Recent emails are fetched, analysed, and routed to **Action Required** or **Needs Review**.
6. Open an email and review the AI task preview. Then **Edit** if needed, **Accept Assignment** (or **Change**), and **Create Task**.
7. Manage the task on **Tasks**: New → Assigned → In Progress → Completed.

**Tip:** for the safest setup, create a Gmail filter that applies the label `AI-Task-Inbox` to client domains, then set Settings → *Which emails to process* → **Only a Gmail label**.

## Testing

```bash
npm test
```

This runs 63 tests with all network calls mocked and an in-memory Postgres (PGlite):

- **Gmail / OAuth:** consent URL (read-only scope, `state`, PKCE), callback (CSRF state mismatch, user denies access, missing scope, disallowed account + revoke, success with encrypted tokens and session cookie), token refresh and caching, revoked refresh token → "Gmail connection expired", Google outage, message parsing (plain/HTML/quoted replies), query builder, 429 retry, 401 → refresh → retry, empty inbox, rate limit, **duplicate detection on re-sync** (no re-import, no AI calls).
- **AI:** strict schema sent to the model, action-required / question / no-action / uncertain / low-confidence routing, deadline and priority extraction, multi-task extraction, hallucinated deadline and client removal, impossible dates, dedupe, threshold decision table, invalid JSON (retry, then a readable failure), provider errors, timeouts, stored model/confidence/timestamp.
- **Assignment:** video → Sandeep, least-loaded fallback, "away" never recommended, invalid team/assignee, wrong-team assignee, unclear ownership, fuzzy matching.
- **Tasks:** create from draft, duplicate approval blocked, accepted vs changed recommendation, edit, assign, New → Assigned → In Progress → Waiting → Completed (and reopen), validation, ignore, manual task, cross-workspace isolation, search, all filters, dashboard metrics, demo seeding.
- **Dataset:** 22 synthetic emails cover all required categories (actionable, non-actionable, ambiguous, multi-task, explicit/relative/no deadline, unclear ownership, multiple recipients, urgent, plus prompt-injection and a reply thread).

Live model evaluation (costs tokens, needs `OPENAI_API_KEY` in `.env.local`):

```bash
npm run eval:ai
```

This prints classification accuracy, action-detection precision/recall/F1, and task-count, deadline, priority, team, assignee and client accuracy against `data/eval/emails.json`.

Other checks:

```bash
npm run typecheck
```

```bash
npm run build
```

## Deployment & website integration

Short version (full guide in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

1. **Supabase**: create a project in `ap-south-1` (Mumbai) and copy the **Transaction pooler** connection string into `DATABASE_URL`. Migrations run automatically on first request, or run `npm run db:migrate`.
2. **Vercel**: import this repo as a *new* project named `agency-action-hub`, set all env vars with production values, and deploy. `vercel.json` pins region `bom1` and schedules the daily sync cron.
3. **Astro site**: add the two rewrites from [`docs/astro-site-vercel.json.example`](docs/astro-site-vercel.json.example) to the Astro repo's `vercel.json` and redeploy. The tool is then live at `https://www.aipmbedanta.com/tools/agency-action-hub`.
4. **Google Cloud**: add `https://www.aipmbedanta.com/tools/agency-action-hub/api/auth/google/callback` as an authorized redirect URI.
5. Optionally, link to the tool from the Astro site, e.g. on `/resources/`.

## Security

- No Gmail password is ever requested or stored. Access is OAuth 2.0 with the least-privilege `gmail.readonly` scope; the app cannot send, modify or delete mail.
- OAuth `state` (CSRF) and PKCE are verified with constant-time comparison, and the verifier lives in a 10-minute signed httpOnly cookie.
- Refresh and access tokens are encrypted with AES-256-GCM before storage. Secrets exist only in server environment variables; nothing sensitive is bundled to the browser.
- Only `ALLOWED_EMAILS` can connect a mailbox. Anyone else is refused and their Google grant is revoked immediately.
- The session is a signed, httpOnly, `SameSite=Lax`, `Secure` (in production) cookie scoped to the base path. POST routes also check `Origin`, and Server Actions allow only the site origin.
- Every query is scoped by `workspace_id`, and demo workspaces are isolated and garbage-collected after 3 days.
- LLM output is never trusted: strict schema, Zod validation, evidence checks, directory checks, and a prompt that treats email content as untrusted (injection-resistant).
- Supabase Data API access is denied via RLS (migration `002`). Security headers are set: `X-Frame-Options: DENY`, `nosniff`, `noindex`.
- `.env*` files are gitignored; only `.env.example` is committed.

More detail: [docs/SECURITY.md](docs/SECURITY.md).

## Known limitations

- **Google verification.** `gmail.readonly` is a *restricted* scope. While the OAuth app is in **Testing** mode, Google expires refresh tokens after **7 days**, so you will see "Gmail connection expired — Reconnect" weekly. Switching the app to **In production** without verification removes the 7-day expiry but shows an "unverified app" warning; that is fine for a single-owner tool (under 100 users). Public multi-user use would require Google's verification and a CASA security assessment.
- **Sync is pull-based.** It runs on a button press, plus an optional cron (Vercel Hobby allows daily; hourly needs Pro). It does not use Gmail push notifications yet.
- **Serverless time budget.** Each sync analyses as many emails as fit in about 50 seconds; any remainder stays *Pending* and continues with **Analyse pending**.
- **Email bodies** are stored as plain text (HTML is converted) and capped at 20k characters, and only about 8k characters go to the AI. Attachments are not read.
- **Single owner.** The data model is multi-tenant (`workspace_id` everywhere), but there is no team login or roles yet.
- **Search** is a simple case-insensitive substring match; it is not full-text search.

## Roadmap

| Phase | Item | Hook already in place |
|---|---|---|
| 2 | WhatsApp Business API | `emails.source` enum and `NewEmail` shape; add a `whatsapp` source and a webhook route |
| 3 | Slack integration | notify on `task_created` / `task_assigned` events |
| 4 | Automatic email monitoring | `sync_frequency` + cron endpoint; move to Gmail `watch` + Pub/Sub |
| 5 | AI workload balancing | `assignment.ts` already weighs availability and active tasks |
| 6 | AI follow-up reminders | `deadline`, `waiting_for_client` status, events |
| 7 | Client/project dashboards | `client` on requirements and tasks |
| 8 | AI evaluation dashboard | every run stored in `ai_analyses` (output, raw, model, prompt version, latency); acceptance/ignore rates already shown; `npm run eval:ai` |
| 9 | Multi-user agency accounts | `workspaces` + `workspace_id` scoping; add users/memberships |
| 10 | SaaS | Google verification + CASA, billing, per-workspace allowlists |
