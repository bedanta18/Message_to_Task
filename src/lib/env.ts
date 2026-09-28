/**
 * Server-only environment access. Nothing here is ever sent to the browser;
 * only NEXT_PUBLIC_APP_URL is public by design.
 */
export { BASE_PATH } from "./base-path";
import { BASE_PATH } from "./base-path";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  get appUrl() {
    return (read("NEXT_PUBLIC_APP_URL") ?? `http://localhost:3000${BASE_PATH}`).replace(/\/$/, "");
  },
  get databaseUrl() {
    const url = read("DATABASE_URL");
    if (!url && process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel (use the Supabase pooled connection string).");
    return url ?? "pglite://./.data/pglite";
  },
  get googleClientId() { return read("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return read("GOOGLE_CLIENT_SECRET"); },
  get googleRedirectUri() { return read("GOOGLE_REDIRECT_URI") ?? `${env.appUrl}/api/auth/google/callback`; },
  get googleConfigured() { return Boolean(read("GOOGLE_CLIENT_ID") && read("GOOGLE_CLIENT_SECRET")); },
  get openaiApiKey() { return read("OPENAI_API_KEY"); },
  get aiBaseUrl() { return (read("AI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""); },
  get aiModel() { return read("AI_MODEL") ?? "gpt-4.1-mini"; },
  get aiResponseFormat(): "json_schema" | "json_object" {
    return read("AI_RESPONSE_FORMAT") === "json_object" ? "json_object" : "json_schema";
  },
  get aiConfigured() { return Boolean(read("OPENAI_API_KEY")); },
  get allowedEmails(): string[] {
    return (read("ALLOWED_EMAILS") ?? "bedanta.product@gmail.com")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  },
  get cronSecret() { return read("CRON_SECRET"); },
  get timezone() { return read("APP_TIMEZONE") ?? "Asia/Kolkata"; },
  get isProd() { return process.env.NODE_ENV === "production"; },
};
