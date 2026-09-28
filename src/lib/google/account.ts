import { decrypt, encrypt } from "../crypto";
import { one, query } from "../db";
import { GmailErrors } from "../errors";
import { refreshAccessToken, revokeToken, type TokenResponse } from "./oauth";

export interface GmailAccountInfo {
  email: string;
  status: "connected" | "expired" | "revoked";
  last_sync_at: Date | null;
  last_error: string | null;
  scope: string;
}

/** Tokens are encrypted before they touch the database and never leave the server. */
export async function saveConnection(workspaceId: string, email: string, t: TokenResponse): Promise<void> {
  const refreshEnc = t.refresh_token ? encrypt(t.refresh_token) : null;
  await query(
    `insert into gmail_accounts (workspace_id, email, refresh_token_enc, access_token_enc, access_token_expires_at, scope, status, last_error)
     values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6, 'connected', null)
     on conflict (workspace_id) do update set
       email = excluded.email,
       refresh_token_enc = coalesce(excluded.refresh_token_enc, gmail_accounts.refresh_token_enc),
       access_token_enc = excluded.access_token_enc,
       access_token_expires_at = excluded.access_token_expires_at,
       scope = excluded.scope,
       status = 'connected',
       last_error = null,
       updated_at = now()`,
    [workspaceId, email, refreshEnc, encrypt(t.access_token), String(t.expires_in ?? 3600), t.scope],
  );
}

export async function getAccount(workspaceId: string): Promise<GmailAccountInfo | null> {
  return one<GmailAccountInfo>(
    "select email, status, last_sync_at, last_error, scope from gmail_accounts where workspace_id = $1",
    [workspaceId],
  );
}

/** Returns a usable access token, refreshing it with the stored refresh token when needed. */
export async function getValidAccessToken(workspaceId: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const acc = await one<{ refresh_token_enc: string | null; access_token_enc: string | null; access_token_expires_at: Date | null; status: string }>(
    "select refresh_token_enc, access_token_enc, access_token_expires_at, status from gmail_accounts where workspace_id = $1",
    [workspaceId],
  );
  if (!acc) throw GmailErrors.notConnected();
  if (acc.status !== "connected") throw GmailErrors.expired();

  const fresh = acc.access_token_expires_at && new Date(acc.access_token_expires_at).getTime() > Date.now() + 60_000;
  if (!opts.forceRefresh && fresh && acc.access_token_enc) return decrypt(acc.access_token_enc);

  if (!acc.refresh_token_enc) {
    await markExpired(workspaceId, "No refresh token stored");
    throw GmailErrors.expired();
  }
  try {
    const t = await refreshAccessToken(decrypt(acc.refresh_token_enc));
    await query(
      "update gmail_accounts set access_token_enc = $2, access_token_expires_at = now() + ($3 || ' seconds')::interval, updated_at = now() where workspace_id = $1",
      [workspaceId, encrypt(t.access_token), String(t.expires_in)],
    );
    return t.access_token;
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "gmail_expired") {
      await markExpired(workspaceId, "Refresh token rejected by Google");
    }
    throw e;
  }
}

async function markExpired(workspaceId: string, reason: string) {
  await query("update gmail_accounts set status = 'expired', last_error = $2, updated_at = now() where workspace_id = $1", [workspaceId, reason]);
}

export async function disconnect(workspaceId: string): Promise<void> {
  const acc = await one<{ refresh_token_enc: string | null }>("select refresh_token_enc from gmail_accounts where workspace_id = $1", [workspaceId]);
  if (acc?.refresh_token_enc) {
    try {
      await revokeToken(decrypt(acc.refresh_token_enc));
    } catch {
      /* best effort — we delete our copy regardless */
    }
  }
  await query("delete from gmail_accounts where workspace_id = $1", [workspaceId]);
}
