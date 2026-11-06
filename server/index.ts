import { env } from "./env";
import { initDb, rows } from "./db/client";
import { createApp } from "./app";
import { sql, count } from "drizzle-orm";
import { db } from "./db/client";
import { admins } from "./db/schema";
import { hashPassword, purgeExpiredSessions } from "./lib/auth";
import { getSettings } from "./lib/settings";

async function seedAdmin() {
  if (!env.adminEmail || !env.adminPassword) return;
  const [{ n }] = await db().select({ n: count() }).from(admins);
  if (n > 0) return;
  await db().insert(admins).values({ email: env.adminEmail.toLowerCase(), name: "Admin", passwordHash: await hashPassword(env.adminPassword), role: "owner" });
  console.log(`[setup] created owner account ${env.adminEmail}`);
}

/** Deletes analytics older than the configured retention window. */
async function retentionSweep() {
  const { privacy } = await getSettings();
  const cutoff = sql`now() - make_interval(days => ${privacy.retentionDays})`;
  const e = await rows<{ n: number }>(sql`WITH d AS (DELETE FROM events WHERE ts < ${cutoff} RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const s = await rows<{ n: number }>(sql`WITH d AS (DELETE FROM searches WHERE ts < ${cutoff} RETURNING 1) SELECT count(*)::int AS n FROM d`);
  await purgeExpiredSessions();
  if (e[0].n || s[0].n) console.log(`[retention] removed ${e[0].n} events and ${s[0].n} searches older than ${privacy.retentionDays} days`);
}

await initDb();
await seedAdmin();
await retentionSweep();
setInterval(() => retentionSweep().catch((err) => console.error("[retention]", err)), 6 * 3600_000).unref();

const app = await createApp();
app.listen(env.port, () => {
  console.log(`Lumen KB running at ${env.publicUrl}`);
  console.log(`  admin:       ${env.publicUrl}/admin`);
  console.log(`  help center: ${env.publicUrl}/help`);
  console.log(`  demo page:   ${env.publicUrl}/demo`);
  console.log(`  database:    ${env.databaseUrl ? "postgres" : `pglite (${env.pgliteDir})`}`);
  console.log(`  AI:          ${env.anthropicKey ? env.aiModel : "off (set ANTHROPIC_API_KEY)"}`);
});
