# Deployment

```
Browser ──► www.aipmbedanta.com/tools/agency-action-hub/*       (Astro project on Vercel)
                    │  vercel.json rewrite (server-side proxy, same domain, cookies pass through)
                    ▼
            agency-action-hub.vercel.app/tools/agency-action-hub/*   (this Next.js project on Vercel, syd1)
                    │
                    ├── Supabase Postgres (ap-south-1)
                    ├── Gmail API (read-only)
                    └── OpenAI-compatible API
```

## 1. Database (Supabase)

1. Create a project at https://supabase.com. The Vercel functions must run in the **same region** as the database: every page makes many sequential queries, and a cross-region hop (e.g. Mumbai ↔ Sydney ≈ 375 ms per query) makes pages take seconds. This deployment uses Supabase **ap-southeast-2 (Sydney)** with Vercel `syd1`; if you create the database elsewhere, change `regions` in `vercel.json` to match (e.g. `ap-south-1` ↔ `bom1`).
2. Go to **Project Settings → Database → Connection string → Transaction pooler** (port `6543`) and copy the URI, which looks like:
   `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
3. Apply the schema. Pick one:
   - Do nothing: the app auto-applies `migrations/*.sql` on its first request.
   - Run it from your machine: `DATABASE_URL=... npm run db:migrate`.
   - Paste `migrations/001_init.sql` and then `002_lock_down_data_api.sql` into the Supabase SQL editor. If you do this, also create and fill `schema_migrations`, or leave auto-migrate on, since it is idempotent.
4. Migration `002` enables RLS with no policies, so Supabase's public Data API (anon key) cannot read any table. The app connects as the owner role and is unaffected.

Any Postgres 14+ (Neon, RDS, and so on) works the same way.

## 2. App (Vercel)

1. Push this folder to a Git repository, for example `agency-action-hub`. It is a separate repository from the website.
2. In Vercel, choose **Add New → Project**, import the repo, and keep the Next.js framework preset. Name the project `agency-action-hub`, which gives it the URL `agency-action-hub.vercel.app`.
3. Add environment variables (Production) under **Settings → Environment Variables**:

   ```
   GOOGLE_CLIENT_ID=…
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_REDIRECT_URI=https://www.aipmbedanta.com/tools/agency-action-hub/api/auth/google/callback
   OPENAI_API_KEY=…
   AI_MODEL=gpt-4.1-mini
   DATABASE_URL=postgresql://…:6543/postgres
   NEXT_PUBLIC_APP_URL=https://www.aipmbedanta.com/tools/agency-action-hub
   TOKEN_ENCRYPTION_KEY=<npm run gen:key>
   SESSION_SECRET=<32+ random chars>
   ALLOWED_EMAILS=bedanta.product@gmail.com
   CRON_SECRET=<random>
   APP_TIMEZONE=Asia/Kolkata
   ```

   `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` use the **public site domain**, not `*.vercel.app`. The OAuth callback and cookies must live on `www.aipmbedanta.com`.
4. Click **Deploy**. `vercel.json` pins the functions to `syd1` (same region as the database) and registers a daily cron (`/api/cron/sync`, 08:00 IST). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically, and the cron only syncs workspaces whose *Sync frequency* is not *Manual*. On the Pro plan you can change the schedule to hourly.
5. Check that `https://agency-action-hub.vercel.app/tools/agency-action-hub` loads the welcome page. Keep **Deployment Protection** at the default ("Standard"): it protects preview URLs only, and the production URL must stay reachable by the website's rewrite.

## 3. Website integration (Astro project)

The Astro site is static and hosted on Vercel, so the integration is a **rewrite**. It needs no code changes, no redesign and no new dependencies.

In the **Astro site's repository**, add these rules to `vercel.json`, creating the file if it doesn't exist. If the file already has a `rewrites` array, append these two entries to it:

```json
{
  "rewrites": [
    { "source": "/tools/agency-action-hub", "destination": "https://agency-action-hub.vercel.app/tools/agency-action-hub" },
    { "source": "/tools/agency-action-hub/:path*", "destination": "https://agency-action-hub.vercel.app/tools/agency-action-hub/:path*" }
  ]
}
```

(The same content is in `docs/astro-site-vercel.json.example`.) Commit and push; Vercel redeploys the site. Only `/tools/agency-action-hub*` is affected, and every existing page keeps working.

Notes:
- The live site serves both `/about` and `/about/` without redirects, so the Next.js base path (no trailing slash) cannot cause a redirect loop.
- If the Astro project uses the `@astrojs/vercel` adapter, `vercel.json` rewrites still apply.
- If a static `/tools/` folder exists in Astro, keep it; the rewrite only matches `/tools/agency-action-hub`.
- Optionally, link to the tool from the site's navigation or `/resources/` page, e.g. `<a href="/tools/agency-action-hub">Agency Action Hub</a>`.

## 4. Google Cloud

Add the production redirect URI and JavaScript origin (see [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md)):

- `https://www.aipmbedanta.com`
- `https://www.aipmbedanta.com/tools/agency-action-hub/api/auth/google/callback`

## 5. Smoke test (MVP success criteria)

1. Open `https://www.aipmbedanta.com/tools/agency-action-hub`.
2. Click **Connect Gmail**; Google OAuth opens.
3. Approve read-only access as `bedanta.product@gmail.com`; you return to the Dashboard showing **Gmail connected**.
4. Click **Sync Emails**; recent Gmail messages are fetched and the AI analyses them.
5. Action-required emails appear under **Action Required**. Open one and the AI task preview appears.
6. **Edit** the task, then **Accept Assignment** (or **Change**), then **Create Task**.
7. The task appears in **Tasks**. Move it New → Assigned → In Progress → Completed.

## Alternative hosting

- **Iframe embed:** possible, but the app sends `X-Frame-Options: DENY` to prevent clickjacking. Google's OAuth pages can't run inside iframes either, so the rewrite is strongly preferred.
- **Subdomain** (e.g. `tools.aipmbedanta.com`): add the domain to this Vercel project, set `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` to it, and add it to `experimental.serverActions.allowedOrigins` in `next.config.ts`.
- **Other Node hosts** (Render, Fly, a VPS): run `npm run build` and then `npm start` with the same env vars behind HTTPS, and point the Astro rewrite at that host.
