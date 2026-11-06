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

export const MEMORY_DB = "memory://";

/**
 * Project rule: app data is never written to the local disk.
 * - DATABASE_URL=postgres://... uses a hosted Postgres (the normal case).
 * - DATABASE_URL=memory:// uses an in-memory Postgres (PGlite) that is gone when the process exits.
 *   Only for demos and tests.
 * Anything else, including no DATABASE_URL, refuses to start.
 */
export async function initDb(): Promise<DB> {
  if (dbInstance) return dbInstance;
  if (!env.databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Point it at a hosted Postgres (e.g. Railway or Neon), or set DATABASE_URL=memory:// for a throwaway in-memory database. Lumen never stores data on the local disk.",
    );
  }
  if (env.databaseUrl === MEMORY_DB && env.isProd) throw new Error("DATABASE_URL=memory:// loses all data on restart and is not allowed in production");
  if (env.databaseUrl !== MEMORY_DB) {
    if (!/^postgres(ql)?:\/\//.test(env.databaseUrl)) throw new Error("DATABASE_URL must be a postgres:// URL or memory://");
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
    const client = new PGlite(MEMORY_DB);
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
