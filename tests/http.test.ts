import { describe, expect, it } from "vitest";
import { appUrl } from "@/lib/http";

// NEXT_PUBLIC_APP_URL in tests: http://localhost:3000/tools/agency-action-hub
const base = "http://localhost:3000/tools/agency-action-hub";

describe("appUrl", () => {
  it("never adds a trailing slash to the app root (the website rewrite 404s on it)", () => {
    expect(appUrl("/").href).toBe(base);
    expect(appUrl().href).toBe(base);
    expect(appUrl("/?connected=1").href).toBe(`${base}?connected=1`);
    expect(appUrl("/?error=access_denied").href).toBe(`${base}?error=access_denied`);
  });

  it("keeps sub-paths unchanged", () => {
    expect(appUrl("/settings?disconnected=1").href).toBe(`${base}/settings?disconnected=1`);
    expect(appUrl("inbox").href).toBe(`${base}/inbox`);
    expect(appUrl("/api/auth/google/callback").href).toBe(`${base}/api/auth/google/callback`);
  });
});
