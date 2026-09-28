/** Load .env.local / .env for CLI scripts (Next.js does this itself for the app). */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* file not present */
  }
}
