import fs from "node:fs";
import crypto from "node:crypto";

// Minimal .env loader so the project runs without extra dependencies.
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const isProd = process.env.NODE_ENV === "production";

function secret(name: string): string {
  const v = process.env[name];
  if (v && v !== "change-me" && v !== "change-me-too") return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  // Dev only: derive a stable value so sessions survive restarts.
  return crypto.createHash("sha256").update(`lumen-dev-${name}`).digest("hex");
}

const port = Number(process.env.PORT ?? 5174);

export const env = {
  isProd,
  isTest: process.env.NODE_ENV === "test",
  port,
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL,
  pgliteDir: process.env.PGLITE_DIR ?? "./data/pglite",
  appSecret: secret("APP_SECRET"),
  visitorPepper: secret("VISITOR_PEPPER"),
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  privacyApiToken: process.env.PRIVACY_API_TOKEN,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  aiModel: process.env.AI_MODEL ?? "claude-opus-5-5",
};
