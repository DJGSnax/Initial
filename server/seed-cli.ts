// `npm run seed`: loads demo content into the hosted database in DATABASE_URL.
import { closeDb, initDb } from "./db/client";
import { seedDemo } from "./seed";

try {
  await initDb();
  await seedDemo();
  await closeDb();
} catch (e) {
  console.error((e as Error).message ?? e);
  process.exit(1);
}
