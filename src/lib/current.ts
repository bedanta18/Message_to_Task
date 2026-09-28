import { cache } from "react";
import { AppError } from "./errors";
import { getAccount, type GmailAccountInfo } from "./google/account";
import { getWorkspace, touchWorkspace, type Workspace } from "./repo/workspace";
import { readSession, type Session } from "./session";

export interface Current {
  session: Session;
  workspace: Workspace;
  gmail: GmailAccountInfo | null;
  isDemo: boolean;
}

/** Resolves the signed session cookie to a workspace. Cached per request. */
export const getCurrent = cache(async (): Promise<Current | null> => {
  const session = await readSession();
  if (!session) return null;
  const workspace = await getWorkspace(session.wid);
  if (!workspace || workspace.kind !== session.kind) return null;
  void touchWorkspace(workspace.id).catch(() => {});
  const gmail = workspace.kind === "owner" ? await getAccount(workspace.id) : null;
  return { session, workspace, gmail, isDemo: workspace.kind === "demo" };
});

export async function requireCurrent(): Promise<Current> {
  const c = await getCurrent();
  if (!c) throw new AppError("no_session", "Your session has ended. Connect Gmail or open the demo to continue.", { status: 401 });
  return c;
}

export async function requireOwner(): Promise<Current> {
  const c = await requireCurrent();
  if (c.isDemo) throw new AppError("demo_only", "This action needs a connected Gmail account — it isn't available in the demo.", { status: 403 });
  return c;
}
