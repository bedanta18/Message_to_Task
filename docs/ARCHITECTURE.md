# Architecture

## Request flow

```
Connect Gmail ─► /api/auth/google/start  (state + PKCE cookie) ─► Google consent (gmail.readonly)
             ◄─ /api/auth/google/callback (verify state, exchange code, profile, allowlist,
                                            encrypt + store tokens, set session) ─► Dashboard

Sync Emails  ─► POST /api/gmail/sync
                 ├─ getValidAccessToken()  (refresh if < 60s left; 401 → force refresh once)
                 ├─ users/me/messages?q=<settings query>&maxResults=N
                 ├─ skip IDs already stored (dedupe by Gmail message ID)
                 ├─ users/me/messages/{id}?format=full ─► parseMessage() ─► INSERT … ON CONFLICT DO NOTHING
                 └─ analyzePending() within a ~50s budget (3 concurrent)
                       └─ analyzeEmail():
                            prompt(email + team directory + workload + received date)
                            ─► chatJson (strict JSON Schema) ─► parseAiOutput (Zod)
                            ─► normalizeAnalysis (evidence checks, directory match, recommendAssignment)
                            ─► persist ai_analyses + requirements, route email:
                                 ACTION_REQUIRED ≥ threshold → action_required
                                 NO_ACTION ≥ threshold       → no_action
                                 otherwise                   → needs_review

Create Task  ─► Server Action approveRequirementAction ─► createTaskFromRequirement (tx, requirement_id UNIQUE)
```

## Data model (Postgres)

| Table | Purpose |
|---|---|
| `workspaces` | tenant boundary (`owner` keyed by Gmail address, or `demo`) |
| `gmail_accounts` | one per workspace; encrypted tokens, status, last sync/error |
| `settings` | sync mode/query/label/size/frequency, AI model, threshold, defaults |
| `teams`, `members` | directory (skills, availability); active task count is computed |
| `emails` | source messages; `UNIQUE(workspace_id, source, external_id)` for dedupe |
| `ai_analyses` | every AI run: classification, confidence, validated output, raw output, model, prompt version, latency, error |
| `requirements` | AI task drafts awaiting approval (`pending` / `approved` / `ignored`) |
| `tasks` | approved work; keeps `email_id`, AI confidence, suggested vs actual assignee, `recommendation_accepted` |
| `events` | product analytics (no content) |

## Design choices

- **Next.js 16 (App Router) in a separate Vercel project.** The Astro site stays static and untouched. Server Components render from the DB directly, Server Actions handle mutations, and route handlers cover OAuth, sync and cron.
- **Raw SQL over a thin adapter** (`src/lib/db.ts`) supporting `pg` (production) and PGlite (local/tests). The result is one dialect, no ORM, fast tests with a real Postgres engine, and zero local setup.
- **No Google SDK and no OpenAI SDK.** The REST calls are small and explicit, which keeps dependencies minimal: `next`, `react`, `zod`, `pg`, `@electric-sql/pglite`.
- **A single LLM call per email** does classification, extraction, decomposition and assignment together, which is cheaper and more coherent. Deterministic code then validates and repairs the result.
- **Explainable assignment.** The AI's suggestion is accepted only if the team and person exist, fit together, and the person isn't away. Otherwise the least-loaded available team member is chosen, with a human-readable reason.

## Extension points (roadmap)

- **New channels (WhatsApp, Slack):** add a value to `emails.source`, build a `NewEmail` from the webhook payload, call `insertEmailIfNew` then `analyzeEmail`. The rest of the pipeline is channel-agnostic.
- **Push-based Gmail:** replace the cron with `users.watch` + Pub/Sub, calling `syncGmail` on notification.
- **Evaluation dashboard:** `ai_analyses` plus `requirements.status` plus `tasks.recommendation_accepted` already give precision proxies (approved vs ignored drafts) and assignment acceptance rate. `npm run eval:ai` gives offline precision/recall/F1 on the labelled dataset.
- **Multi-user:** add `users` and `workspace_members` tables, then swap the session payload from `wid` to `userId` plus the active workspace. All queries are already workspace-scoped.
