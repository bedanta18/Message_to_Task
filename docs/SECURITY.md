# Security considerations

## Gmail access

| Control | Implementation |
|---|---|
| No passwords | Google OAuth 2.0 Authorization Code flow only (`src/lib/google/oauth.ts`). The app has no password field. |
| Least privilege | The only scope is `https://www.googleapis.com/auth/gmail.readonly`. The callback rejects a grant that lacks it, and every Gmail API call is a `GET`. |
| CSRF | A random `state` value is stored in a signed, httpOnly, 10-minute cookie and compared in constant time in the callback. |
| Code interception | PKCE (S256): the `code_verifier` never leaves the server-side cookie. |
| Owner-only | After consent the server calls `users/me/profile`. If the address is not in `ALLOWED_EMAILS`, the grant is **revoked** and nothing is stored. |
| Token storage | Refresh and access tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, random 96-bit IV, auth tag) before insert. Tokens are never sent to the browser or written to logs. |
| Expiry / revocation | `invalid_grant` marks the account as `expired`, and the UI shows "Gmail connection expired. Please reconnect your account." **Disconnect** revokes the grant at Google and deletes the tokens. |

## Sessions & requests

- Cookie `aah_session` holds a signed `{workspaceId, kind, exp}` with HMAC-SHA256 (`SESSION_SECRET`). It is `httpOnly`, `SameSite=Lax`, `Secure` in production, scoped to the base path, and lasts 30 days (3 for demo).
- POST route handlers check the `Origin` header. Server Actions use Next.js origin checks, with `allowedOrigins` limited to `www.aipmbedanta.com` and `aipmbedanta.com`.
- Every mutation resolves the workspace from the cookie and scopes all SQL by `workspace_id`. A test proves one workspace can't touch another's data.
- All inputs are validated with Zod (tasks, settings). IDs are checked as UUIDs before querying, and all SQL is parameterised.
- `/api/cron/sync` requires `Authorization: Bearer $CRON_SECRET`, compared in constant time.
- Headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `X-Robots-Tag: noindex`.

## AI

- **Raw LLM output is never trusted.** The pipeline uses a strict JSON Schema response format, then Zod validation, then evidence checks (the deadline wording and client must appear in the email), then directory checks (team and member must exist). Invalid output is retried once and then stored as a failed analysis, and the email is kept.
- **Prompt injection:** email content is wrapped in `<email>` tags, and the system prompt tells the model to treat it as untrusted data. The dataset includes an injection sample (`e19`). The worst-case outcome is still only a *draft* that a human must approve.
- **Human in the loop:** there is no code path that creates a task without a human action.
- **Data sent to the AI provider:** sender, recipients, subject, the first ~8k characters of the body, and the team directory (names, skills, workload). Choose a provider and plan whose data-retention terms you accept. OpenAI's API does not train on API data by default.

## Data

- **Supabase:** migration `002` enables RLS with no policies, so the anon/authenticated Data API cannot read any table.
- **Analytics:** the `events` table stores ids, counts and enums only. No subjects, bodies or addresses are stored there, and no third-party analytics are loaded.
- **Demo:** workspaces contain only synthetic data, are isolated per visitor, and are deleted after 3 days of inactivity.
- **Secrets:** exist only in environment variables. `.env*` is gitignored and `.env.example` holds no values.

## Operational checklist

- [ ] Generate unique `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` and `CRON_SECRET` for production. Never reuse the local ones.
- [ ] HTTPS only: Vercel enforces it and HSTS is already set on the site.
- [ ] Rotating `TOKEN_ENCRYPTION_KEY` makes stored tokens unreadable, so reconnect Gmail after rotating.
- [ ] Review Google third-party access periodically at https://myaccount.google.com/permissions.
