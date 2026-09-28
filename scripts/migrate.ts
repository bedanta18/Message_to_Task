/**
 * Apply SQL migrations to DATABASE_URL. The app also auto-migrates on cold start
 * (unless AUTO_MIGRATE=false), but running this in CI/deploy is more explicit.
 *   npm run db:migrate
 */
import "./load-env";

async function main() {
  process.env.AUTO_MIGRATE = "false";
  const { db, migrate } = await import("../src/lib/db");
  const ran = await migrate(await db());
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
