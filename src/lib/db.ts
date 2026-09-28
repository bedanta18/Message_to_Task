import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

/**
 * Minimal database adapter over either node-postgres (Supabase / any Postgres in
 * production) or PGlite (embedded Postgres, zero-setup local dev and tests).
 * Both speak real Postgres SQL, so there is one schema and one query dialect.
 */
export type Row = Record<string, unknown>;
export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

type Runner = { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> };
const g = globalThis as unknown as { __aahDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!g.__aahDb) {
    g.__aahDb = connect().catch((e) => {
      g.__aahDb = undefined;
      throw e;
    });
  }
  return g.__aahDb;
}

export async function query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db()).query<T>(sql, params);
}

export async function one<T = Row>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return (await db()).tx(fn);
}

async function connect(): Promise<Db> {
  const url = env.databaseUrl;
  const database = url.startsWith("pglite://") ? await connectPglite(url.slice("pglite://".length)) : await connectPg(url);
  if (process.env.AUTO_MIGRATE !== "false") await migrate(database);
  return database;
}

function wrapRunner(runner: Runner, txImpl: Db["tx"]): Db {
  return {
    query: async <T,>(s: string, p?: unknown[]) => (await runner.query(s, p)).rows as T[],
    tx: txImpl,
  };
}

async function connectPg(url: string): Promise<Db> {
  const mod = await import("pg");
  const pg = (mod as unknown as { default?: typeof mod }).default ?? mod;
  pg.types.setTypeParser(1082, (v: string) => v); // DATE → 'YYYY-MM-DD' (avoid timezone shifts)
  pg.types.setTypeParser(1700, (v: string) => Number(v)); // NUMERIC → number
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  const rootTx: Db["tx"] = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const inner: Db = wrapRunner(client, (f) => f(inner)); // nested tx → same connection
      const result = await fn(inner);
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  return wrapRunner(pool, rootTx);
}

async function connectPglite(location: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dataDir = location === "memory" || location === "" ? undefined : path.resolve(location);
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const parsers = { [types.DATE]: (v: string) => v, [types.NUMERIC]: (v: string) => Number(v) };
  const pglite = new PGlite({ dataDir, parsers });
  await pglite.waitReady;
  const rootTx: Db["tx"] = (fn) =>
    pglite.transaction(async (t) => {
      const inner: Db = wrapRunner(t as unknown as Runner, (f) => f(inner));
      return fn(inner);
    });
  return wrapRunner(pglite as unknown as Runner, rootTx);
}

/** Applies migrations/*.sql in order, once each. Safe to call on every cold start. */
export async function migrate(database: Db): Promise<string[]> {
  const dir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await database.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set((await database.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await database.tx(async (t) => {
      // Serialise concurrent cold starts on real Postgres.
      if (!env.databaseUrl.startsWith("pglite://")) await t.query("select pg_advisory_xact_lock(724413)");
      if ((await t.query("select 1 from schema_migrations where name = $1", [file])).length) return;
      for (const stmt of splitSql(sql)) await t.query(stmt);
      await t.query("insert into schema_migrations (name) values ($1)", [file]);
      ran.push(file);
    });
  }
  return ran;
}

function splitSql(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
