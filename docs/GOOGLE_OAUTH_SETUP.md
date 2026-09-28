# Google Cloud / Gmail OAuth setup

This takes about 10 minutes, all in the [Google Cloud Console](https://console.cloud.google.com/). Signing in as `bedanta.product@gmail.com` keeps ownership simple.

## 1. Create a project

Open **Select a project → New project**, name it `Agency Action Hub`, and create it.

## 2. Enable the Gmail API

Go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.

## 3. Configure the consent screen (Google Auth Platform)

Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles).

1. **Branding**
   - App name: `Agency Action Hub`
   - User support email: `bedanta.product@gmail.com`
   - App domain / homepage: `https://www.aipmbedanta.com`
   - Authorized domains: `aipmbedanta.com`
   - Developer contact: `bedanta.product@gmail.com`
2. **Audience**
   - User type: **External**. A personal `@gmail.com` account cannot use "Internal".
   - Publishing status: start in **Testing**.
   - **Test users**: add `bedanta.product@gmail.com`.
3. **Data access → Add or remove scopes**
   - Add **only** `https://www.googleapis.com/auth/gmail.readonly`, which appears as *".../auth/gmail.readonly — View your email messages and settings"*.
   - Do **not** add send, compose, modify, or `https://mail.google.com/`.

## 4. Create the OAuth client

Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.

- Application type: **Web application**
- Name: `Agency Action Hub (web)`
- **Authorized JavaScript origins**
  - `http://localhost:3000`
  - `https://www.aipmbedanta.com`
- **Authorized redirect URIs** (must match `GOOGLE_REDIRECT_URI` exactly)
  - `http://localhost:3000/tools/agency-action-hub/api/auth/google/callback`
  - `https://www.aipmbedanta.com/tools/agency-action-hub/api/auth/google/callback`

Click **Create**, then copy the **Client ID** and **Client secret** into your environment:

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
GOOGLE_REDIRECT_URI=https://www.aipmbedanta.com/tools/agency-action-hub/api/auth/google/callback
```

Never commit these values. Set them in `.env.local` locally, and in Vercel → Project → Settings → Environment Variables for production.

## 5. Testing vs. In production

| Status | Behaviour | Good for |
|---|---|---|
| **Testing** | Only listed test users can connect. **Refresh tokens expire after 7 days**, and the app then shows "Gmail connection expired. Please reconnect your account." | first run, development |
| **In production (unverified)** | Google shows an "app isn't verified" warning, and the owner clicks *Advanced → Go to …*. Refresh tokens no longer expire weekly. Limited to 100 users. | this personal, single-owner tool |
| **In production (verified)** | Requires Google's restricted-scope verification and an annual CASA security assessment. | a future public SaaS version |

The app is designed for the first two. `ALLOWED_EMAILS` also enforces owner-only access on the server, so even an unverified production app refuses any other Google account and revokes its grant.

## 6. Verify

1. Run the app, open `/tools/agency-action-hub`, and click **Connect Gmail**.
2. The Google consent screen should list only **"View your email messages and settings"**.
3. After you approve, you return to the dashboard showing **Gmail connected: bedanta.product@gmail.com**.
4. You can review or revoke access at any time at https://myaccount.google.com/permissions, or use **Settings → Disconnect**, which revokes the grant and deletes the stored tokens.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google Cloud must match `GOOGLE_REDIRECT_URI` character for character, including `www` and the base path. |
| "Access blocked: app has not completed verification" | Add the account under **Audience → Test users**, or switch the app to *In production*. |
| Returns with "Gmail read access was not granted" | Make sure the scope checkbox on the consent screen was ticked. |
| "This tool is private to its owner" | The Google account isn't listed in `ALLOWED_EMAILS`. |
| "Gmail connection expired" after a week | This is expected in Testing mode; click **Reconnect Gmail**. |
| `?error=state_mismatch` | The consent flow took more than 10 minutes or crossed browsers; start again. |
