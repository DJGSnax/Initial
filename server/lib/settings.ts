import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { settings as settingsTable } from "../db/schema";
import type { Settings } from "../../shared/types";

export const DEFAULT_SETTINGS: Settings = {
  siteName: "Help Center",
  allowedOrigins: [],
  launcher: {
    enabled: true,
    position: "bottom-right",
    label: "Help",
    accent: "#4f46e5",
    greeting: "How can we help?",
    urlRules: [],
  },
  privacy: {
    requireConsent: true,
    respectGpc: true,
    storage: "functional_allowed",
    allowedTraits: ["plan", "role", "locale", "account_age_days", "product", "app_version"],
    retentionDays: 180,
    nudgeContext: "path_and_headings",
  },
  ai: {
    overview: true,
    nudges: true,
    nudgeCooldownMin: 10,
  },
};

let cache: Settings | null = null;

function merge<T extends object>(base: T, patch: Partial<T> | undefined): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch ?? {})) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v) ? merge(b as object, v as object) : v;
  }
  return out as T;
}

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const row = await db().query.settings.findFirst({ where: eq(settingsTable.key, "app") });
  cache = merge(DEFAULT_SETTINGS, (row?.value as Partial<Settings>) ?? {});
  return cache;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = merge(await getSettings(), patch);
  await db()
    .insert(settingsTable)
    .values({ key: "app", value: next })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: next } });
  cache = next;
  return next;
}

export function clearSettingsCache() {
  cache = null;
}
