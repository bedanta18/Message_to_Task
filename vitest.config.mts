import { defineConfig } from "vitest/config";
import path from "node:path";

const live = Boolean(process.env.LIVE_AI_TEST);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 90000,
    // Each test file boots its own embedded Postgres (PGlite/WASM); too many at once
    // can exhaust memory and crash a worker, so cap parallelism.
    maxWorkers: 2,
    env: {
      DATABASE_URL: "pglite://memory",
      TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
      GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/tools/agency-action-hub/api/auth/google/callback",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000/tools/agency-action-hub",
      // Unit tests mock all network calls. The opt-in live test (LIVE_AI_TEST=1) uses your real key/provider.
      OPENAI_API_KEY: live ? (process.env.OPENAI_API_KEY ?? "") : "sk-test",
      AI_BASE_URL: live ? (process.env.AI_BASE_URL ?? "") : "https://api.openai.com/v1",
      AI_RESPONSE_FORMAT: live ? (process.env.AI_RESPONSE_FORMAT ?? "") : "json_schema",
      ALLOWED_EMAILS: "bedanta.product@gmail.com",
      APP_TIMEZONE: "Asia/Kolkata",
    },
  },
});
