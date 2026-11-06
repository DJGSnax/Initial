import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "../env";

export type DB = NodePgDatabase<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));

function migrationsFolder() {
  // Source layout (tsx) and bundled layout (dist/server) both work.
  const candidates = [path.join(here, "migrations"), path.resolve("server/db/migrations")];
  return candidates.find((p) => fs.existsSync(p))!;
}

let dbInstance: DB | null = null;
let closeFn: (() => Promise<void>) | null = null;

/**
 * Uses Postgres when DATABASE_URL is set, otherwise an embedded PGlite database
 * (real Postgres compiled to WASM) so local dev needs no setup.
 * PGLITE_DIR=memory:// gives a throwaway in-memory database (used by tests).
 */
export async function initDb(): Promise<DB> {
  if (dbInstance) return dbInstance;
  if (env.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    dbInstance = db;
    closeFn = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    if (!env.pgliteDir.startsWith("memory://")) fs.mkdirSync(env.pgliteDir, { recursive: true });
    const client = new PGlite(env.pgliteDir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    dbInstance = db as unknown as DB;
    closeFn = () => client.close();
  }
  return dbInstance;
}

export function db(): DB {
  if (!dbInstance) throw new Error("Database not initialised");
  return dbInstance;
}

export async function closeDb() {
  await closeFn?.();
  dbInstance = null;
  closeFn = null;
}

/** Raw query helper that works for both drivers. */
export async function rows<T = Record<string, unknown>>(query: Parameters<DB["execute"]>[0]): Promise<T[]> {
  const res = (await db().execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
