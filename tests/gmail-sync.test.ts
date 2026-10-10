import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { saveConnection } from "@/lib/google/account";
import { resetSyncedData } from "@/lib/repo/emails";
import { buildQuery, countMessages, daysInQuery, gmailGet, GmailUnauthorized, htmlToText, listMessageIds, parseMessage, stripQuoted, withinRange } from "@/lib/google/gmail";
import { GMAIL_SCOPE } from "@/lib/google/oauth";
import { syncGmail } from "@/lib/sync";
import { aiResponse, aiTask, gmailMessage, json, mockFetch, ownerWorkspace } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("Gmail message parsing", () => {
  it("extracts sender, recipients, subject, timestamp, body and message id", () => {
    const e = parseMessage(gmailMessage("m1", {
      from: '"Meera Iyer" <Meera@Apollo.example>', subject: "Creatives", body: "Please create five creatives.", cc: "ops@apollo.example",
      date: Date.parse("2026-09-27T10:00:00Z"),
    }));
    expect(e).toMatchObject({
      external_id: "m1", thread_id: "t-m1", from_name: "Meera Iyer", from_email: "meera@apollo.example",
      to_addresses: "bedanta.product@gmail.com", cc_addresses: "ops@apollo.example", subject: "Creatives", body: "Please create five creatives.",
    });
    expect(e.received_at.toISOString()).toBe("2026-09-27T10:00:00.000Z");
  });

  it("falls back to HTML and strips tags", () => {
    const e = parseMessage(gmailMessage("m2", { from: "a@b.co", subject: "x", body: "<p>Hello&nbsp;<b>team</b></p><ul><li>One</li></ul>", html: true }));
    expect(e.body).toContain("Hello team");
    expect(e.body).toContain("• One");
    expect(htmlToText("<style>p{}</style><p>a</p>")).toBe("a");
  });

  it("drops quoted reply history", () => {
    expect(stripQuoted("Please send the URL.\n\nOn Mon, 1 Sep 2026 at 10:00, Bedanta wrote:\n> old text")).toBe("Please send the URL.");
  });

  it("rejects an invalid message", () => {
    expect(() => parseMessage({} as never)).toThrow();
  });
});

describe("Gmail query builder", () => {
  const base = { gmail_query: "newer_than:30d", label_filter: "AI-Task-Inbox" };
  it("recent / label / both", () => {
    expect(buildQuery({ ...base, sync_mode: "recent" })).toBe("newer_than:30d");
    expect(buildQuery({ ...base, sync_mode: "label" })).toBe("label:AI-Task-Inbox");
    expect(buildQuery({ ...base, sync_mode: "both" })).toBe("label:AI-Task-Inbox newer_than:30d");
    expect(buildQuery({ gmail_query: "", label_filter: "Client Work", sync_mode: "label" })).toBe("label:Client-Work");
  });
});

describe("Sync range overrides", () => {
  it("replaces date terms with the chosen time window", () => {
    expect(withinRange("in:inbox newer_than:7d -from:me", { after: 1700000000 })).toBe("in:inbox -from:me after:1700000000");
    expect(withinRange("label:AI-Task-Inbox after:2024/01/01 before:2024/02/01", { after: 1700000000, before: 1700086400 }))
      .toBe("label:AI-Task-Inbox after:1700000000 before:1700086400");
    expect(withinRange("", { after: 1 })).toBe("after:1");
  });
  it("reads the day range from a saved query", () => {
    expect(daysInQuery("in:inbox newer_than:14d")).toBe(14);
    expect(daysInQuery("newer_than:2m")).toBe(60);
    expect(daysInQuery("in:inbox")).toBeNull();
  });
  it("pages through Gmail up to the requested count", async () => {
    const pages: Record<string, { messages: { id: string }[]; nextPageToken?: string }> = {
      "": { messages: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })), nextPageToken: "p2" },
      p2: { messages: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` })), nextPageToken: "p3" },
    };
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const u = new URL(String(input));
      seen.push(u.searchParams.get("maxResults")!);
      return new Response(JSON.stringify(pages[u.searchParams.get("pageToken") ?? ""]), { status: 200 });
    }) as typeof fetch;
    const ids = await listMessageIds("tok", "newer_than:7d", 75, fetchImpl);
    expect(ids).toHaveLength(75);
    expect(seen).toEqual(["50", "25"]);
  });
  it("counts emails in range exactly, ignoring Gmail's estimate", async () => {
    const pages: Record<string, { messages: { id: string }[]; nextPageToken?: string; resultSizeEstimate: number }> = {
      "": { messages: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), nextPageToken: "p2", resultSizeEstimate: 3 },
      p2: { messages: Array.from({ length: 120 }, (_, i) => ({ id: `b${i}` })), resultSizeEstimate: 3 },
    };
    const fetchImpl = (async (input: string | URL) =>
      new Response(JSON.stringify(pages[new URL(String(input)).searchParams.get("pageToken") ?? ""]), { status: 200 })) as typeof fetch;
    expect(await countMessages("tok", "after:1", 1000, fetchImpl)).toBe(620);
  });
});

describe("Gmail API client", () => {
  it("retries on 429 then succeeds", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 2 ? new Response("rate", { status: 429 }) : json({ ok: 1 })));
    await expect(gmailGet("/x", "t", f as unknown as typeof fetch)).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("signals 401 so the caller can refresh", async () => {
    const f = vi.fn(async () => new Response("", { status: 401 }));
    await expect(gmailGet("/x", "t", f as unknown as typeof fetch)).rejects.toBeInstanceOf(GmailUnauthorized);
  });
});

describe("syncGmail end-to-end (mocked Google + AI)", () => {
  let wid: string;
  beforeAll(async () => {
    wid = await ownerWorkspace();
    await saveConnection(wid, "bedanta.product@gmail.com", { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GMAIL_SCOPE, token_type: "Bearer" });
  });

  const messages = {
    a1: gmailMessage("a1", { from: "Meera <meera@apollohealthacademy.example>", subject: "October creatives", body: "Please create five social media creatives for our October campaign. We need the first draft by Wednesday." }),
    a2: gmailMessage("a2", { from: "anita@greenleaf.example", subject: "Re: report", body: "Thanks for sharing the report." }),
    a3: gmailMessage("a3", { from: "sana@orbit.example", subject: "Q4", body: "Interesting. Let's discuss this tomorrow." }),
    self: gmailMessage("self", { from: "Bedanta <bedanta.product@gmail.com>", subject: "sent", body: "my own mail" }),
  };

  function routes(ids: string[]) {
    return {
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => json({ messages: ids.map((id) => ({ id })) }),
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/": (u: URL) => json(messages[u.pathname.split("/").pop() as keyof typeof messages]),
      "https://api.openai.com/v1/chat/completions": (_u: URL, init?: RequestInit) => {
        const prompt = String(init?.body);
        if (prompt.includes("October campaign")) {
          return aiResponse({
            classification: "ACTION_REQUIRED", confidence: 0.93, reason: "Explicit request", client: "Apollo Healthcare Academy",
            tasks: [aiTask({ title: "Create 5 October campaign creatives", deliverable: "5 social media creatives", deadline: "2026-09-30", deadline_text: "by Wednesday", suggested_team: "Design", suggested_assignee: "Riya", assignment_reason: "Design work", confidence: 0.93 })],
          });
        }
        if (prompt.includes("Thanks for sharing")) return aiResponse({ classification: "NO_ACTION", confidence: 0.97, reason: "Thanks", client: null, tasks: [] });
        return aiResponse({ classification: "UNCERTAIN", confidence: 0.55, reason: "Vague", client: null, tasks: [] });
      },
    };
  }

  it("fetches, skips own mail, classifies and routes emails", async () => {
    const { calls } = mockFetch(routes(["a1", "a2", "a3", "self"]));
    const r = await syncGmail(wid);
    expect(r).toMatchObject({ found: 4, new: 3, skipped: 1, duplicates: 0, analyzed: 3, actionRequired: 1, noAction: 1, needsReview: 1, failed: 0 });
    // Read-only: every Gmail call is a GET.
    expect(calls.filter((c) => c.url.includes("gmail.googleapis.com")).every((c) => !c.init?.method || c.init.method === "GET")).toBe(true);

    const emails = await query<{ external_id: string; status: string }>("select external_id, status from emails where workspace_id = $1 order by external_id", [wid]);
    expect(emails).toEqual([
      { external_id: "a1", status: "action_required" },
      { external_id: "a2", status: "no_action" },
      { external_id: "a3", status: "needs_review" },
    ]);
    const [req] = await query<{ title: string; deadline: string; client: string }>("select r.title, r.deadline, r.client from requirements r join emails e on e.id = r.email_id where e.external_id = 'a1'");
    expect(req).toEqual({ title: "Create 5 October campaign creatives", deadline: "2026-09-30", client: "Apollo Healthcare Academy" });
  });

  it("does not duplicate emails, requirements or AI calls when synced twice", async () => {
    const { calls } = mockFetch(routes(["a1", "a2", "a3"]));
    const r = await syncGmail(wid);
    expect(r).toMatchObject({ found: 3, new: 0, duplicates: 3, analyzed: 0 });
    expect(calls.some((c) => c.url.includes("openai"))).toBe(false);
    expect(calls.some((c) => /messages\/a1/.test(c.url))).toBe(false);
    const [{ n }] = (await query<{ n: number }>("select count(*)::int as n from emails where workspace_id = $1", [wid])) as [{ n: number }];
    expect(n).toBe(3);
    const [{ r: reqs }] = (await query<{ r: number }>("select count(*)::int as r from requirements where workspace_id = $1", [wid])) as [{ r: number }];
    expect(reqs).toBe(1);
  });

  it("handles an empty inbox", async () => {
    mockFetch({ "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => json({ resultSizeEstimate: 0 }) });
    await expect(syncGmail(wid)).resolves.toMatchObject({ found: 0, new: 0 });
  });

  it("refreshes once on 401 and continues", async () => {
    let listCalls = 0;
    const { calls } = mockFetch({
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => (++listCalls === 1 ? new Response("", { status: 401 }) : json({ messages: [] })),
      "https://oauth2.googleapis.com/token": () => json({ access_token: "refreshed", expires_in: 3600 }),
    });
    await syncGmail(wid);
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    const auth = (calls.at(-1)!.init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Bearer refreshed");
  });

  it("reset removes synced data but keeps manual tasks and the Gmail connection", async () => {
    const [req] = await query<{ id: string; email_id: string }>("select id, email_id from requirements where workspace_id = $1 limit 1", [wid]);
    await query("insert into tasks (workspace_id, email_id, requirement_id, title) values ($1, $2, $3, 'From email')", [wid, req!.email_id, req!.id]);
    await query("insert into tasks (workspace_id, title) values ($1, 'Manual task')", [wid]);
    await query("update gmail_accounts set last_sync_at = now() where workspace_id = $1", [wid]);

    const removed = await resetSyncedData(wid);
    expect(removed).toEqual({ emails: 3, tasks: 1 });
    const count = async (table: string) => ((await query<{ n: number }>(`select count(*)::int as n from ${table} where workspace_id = $1`, [wid]))[0]!.n);
    expect(await count("emails")).toBe(0);
    expect(await count("ai_analyses")).toBe(0);
    expect(await count("requirements")).toBe(0);
    expect(await query<{ title: string }>("select title from tasks where workspace_id = $1", [wid])).toEqual([{ title: "Manual task" }]);
    const [acct] = await query<{ status: string; last_sync_at: string | null }>("select status, last_sync_at from gmail_accounts where workspace_id = $1", [wid]);
    expect(acct).toEqual({ status: "connected", last_sync_at: null });

    // A fresh sync after reset re-imports the same emails.
    mockFetch(routes(["a1", "a2", "a3"]));
    await expect(syncGmail(wid)).resolves.toMatchObject({ found: 3, new: 3, duplicates: 0 });
  });

  it("reports rate limiting in plain language", async () => {
    mockFetch({ "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => new Response("", { status: 429 }) });
    await expect(syncGmail(wid)).rejects.toMatchObject({ code: "gmail_rate_limited" });
  }, 20_000);
});
