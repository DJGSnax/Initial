import { z } from "zod";

const urlRule = z.object({
  op: z.enum(["contains", "equals", "starts_with", "glob", "regex"]),
  value: z.string().max(300),
  exclude: z.boolean().optional(),
});

const traitRule = z.object({
  key: z.string().min(1).max(40),
  op: z.enum(["eq", "neq", "in", "not_in", "gt", "lt", "exists", "not_exists"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});

export const stepSchema = z.object({
  id: z.string().min(1).max(40),
  selector: z.string().max(500).optional(),
  title: z.string().max(140).default(""),
  body: z.string().max(4000).default(""),
  placement: z.enum(["auto", "top", "bottom", "left", "right"]).optional(),
  articleSlug: z.string().max(120).optional(),
  ctaLabel: z.string().max(60).optional(),
  ctaUrl: z
    .string()
    .max(500)
    .refine((u) => !u || /^(https?:\/\/|\/)/.test(u), "CTA URL must be http(s) or a relative path")
    .optional(),
  spotlight: z.boolean().optional(),
  advanceOnClick: z.boolean().optional(),
});

export const definitionSchema = z.object({
  steps: z.array(stepSchema).min(1).max(30),
  targeting: z.object({
    urlRules: z.array(urlRule).max(20).default([]),
    traitRules: z.array(traitRule).max(20).default([]),
    audience: z.enum(["all", "identified", "anonymous"]).default("all"),
  }),
  trigger: z.object({
    type: z.enum(["page_load", "delay", "scroll", "element_click", "custom_event", "rage_click", "idle", "repeat_visit", "exit_intent"]),
    delayMs: z.number().int().min(0).max(600_000).optional(),
    scrollPct: z.number().min(0).max(100).optional(),
    selector: z.string().max(500).optional(),
    eventName: z.string().max(80).optional(),
    idleMs: z.number().int().min(1000).max(600_000).optional(),
    visits: z.number().int().min(1).max(50).optional(),
  }),
  frequency: z.object({
    mode: z.enum(["once", "once_per_session", "every_time", "until_dismissed", "every_n_days"]),
    days: z.number().int().min(1).max(365).optional(),
    maxImpressions: z.number().int().min(1).max(1000).optional(),
  }),
  theme: z
    .object({
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{3,8}$/)
        .optional(),
      position: z.enum(["top", "bottom"]).optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
      dismissible: z.boolean().optional(),
      beacon: z.boolean().optional(),
    })
    .default({}),
});

export const promptSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["tooltip", "hotspot", "modal", "banner", "tour"]),
  status: z.enum(["draft", "live", "paused", "archived"]).default("draft"),
  priority: z.number().int().min(-100).max(100).default(0),
  definition: definitionSchema,
});

export const articleSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]*$/)
    .optional(),
  summary: z.string().max(400).default(""),
  bodyMd: z.string().max(200_000).default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  collectionId: z.number().int().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  contextPaths: z.array(z.string().max(200)).max(20).default([]),
});

export const collectionSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]*$/)
    .optional(),
  description: z.string().max(400).default(""),
  icon: z.string().max(30).default("book"),
  position: z.number().int().default(0),
});

export const settingsSchema = z
  .object({
    siteName: z.string().min(1).max(80),
    allowedOrigins: z.array(z.string().regex(/^https?:\/\/[^/\s]+$|^\*$/, "Origins look like https://app.example.com")).max(50),
    launcher: z
      .object({
        enabled: z.boolean(),
        position: z.enum(["bottom-right", "bottom-left"]),
        label: z.string().max(30),
        accent: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
        greeting: z.string().max(80),
        urlRules: z.array(urlRule).max(20),
      })
      .partial(),
    privacy: z
      .object({
        requireConsent: z.boolean(),
        respectGpc: z.boolean(),
        storage: z.enum(["consent_required", "functional_allowed"]),
        allowedTraits: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(30),
        retentionDays: z.number().int().min(1).max(3650),
        nudgeContext: z.enum(["path_only", "path_and_headings"]),
      })
      .partial(),
    ai: z
      .object({
        overview: z.boolean(),
        nudges: z.boolean(),
        nudgeCooldownMin: z.number().int().min(1).max(1440),
      })
      .partial(),
  })
  .partial();
