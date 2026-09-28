import { vi } from "vitest";
import type { AiAnalysis, AiTask } from "@/lib/ai/schema";
import { findOrCreateOwnerWorkspace } from "@/lib/repo/workspace";

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** Routes global fetch by URL prefix. Unmatched requests fail loudly (no real network in tests). */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url: url.href, init });
    const key = Object.keys(routes)
      .filter((k) => url.href.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Unmocked fetch: ${url.href}`);
    return routes[key]!(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export function gmailMessage(id: string, opts: { from: string; subject: string; body: string; to?: string; cc?: string; date?: number; html?: boolean }) {
  const part = { mimeType: opts.html ? "text/html" : "text/plain", body: { data: b64url(opts.body) } };
  return {
    id,
    threadId: `t-${id}`,
    labelIds: ["INBOX"],
    snippet: opts.body.slice(0, 80),
    internalDate: String(opts.date ?? Date.parse("2026-09-28T04:30:00Z")),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: opts.from },
        { name: "To", value: opts.to ?? "bedanta.product@gmail.com" },
        ...(opts.cc ? [{ name: "Cc", value: opts.cc }] : []),
        { name: "Subject", value: opts.subject },
      ],
      parts: [part],
    },
  };
}

export function aiTask(p: Partial<AiTask> & Pick<AiTask, "title">): AiTask {
  return {
    description: p.title, deliverable: null, client: null, priority: "medium", deadline: null, deadline_text: null,
    dependencies: [], instructions: [], suggested_team: null, suggested_assignee: null, assignment_reason: null, confidence: 0.9, ...p,
  };
}

export function aiResponse(a: AiAnalysis, model = "gpt-test") {
  return json({ model, choices: [{ message: { content: JSON.stringify(a) } }] });
}

export async function ownerWorkspace(email = "bedanta.product@gmail.com") {
  return findOrCreateOwnerWorkspace(email);
}
