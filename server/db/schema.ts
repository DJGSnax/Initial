import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PromptDefinition } from "../../shared/types";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"owner" | "editor" | "viewer">().notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable("admin_sessions", {
  /** sha256 of the cookie token, so a DB leak does not leak live sessions */
  tokenHash: text("token_hash").primaryKey(),
  adminId: integer("admin_id")
    .notNull()
    .references(() => admins.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("book"),
  position: integer("position").notNull().default(0),
});

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
    collectionId: integer("collection_id").references(() => collections.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** tags joined with spaces; kept in sync by the app because array_to_string isn't immutable */
    keywords: text("keywords").notNull().default(""),
    /** URL rules (comma separated paths/globs) where this article is most relevant in the app */
    contextPaths: text("context_paths").array().notNull().default(sql`'{}'::text[]`),
    position: integer("position").notNull().default(0),
    authorId: integer("author_id").references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(keywords, '')), 'B') || setweight(to_tsvector('english', coalesce(body_text, '')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex("articles_slug_idx").on(t.slug),
    index("articles_search_idx").using("gin", t.searchVector),
    index("articles_status_idx").on(t.status),
  ],
);

export const articleRevisions = pgTable("article_revisions", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  authorId: integer("author_id").references(() => admins.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").$type<"tooltip" | "hotspot" | "modal" | "banner" | "tour">().notNull(),
  status: text("status").$type<"draft" | "live" | "paused" | "archived">().notNull().default("draft"),
  priority: integer("priority").notNull().default(0),
  definition: jsonb("definition").$type<PromptDefinition>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Analytics events. No IP address, no user agent string, no query strings.
 * visitor_id is HMAC(VISITOR_PEPPER, id the host app already pseudonymised).
 * session_id and visitor_id are null unless the viewer gave analytics consent.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    visitorId: text("visitor_id"),
    sessionId: text("session_id"),
    promptId: integer("prompt_id"),
    articleId: integer("article_id"),
    step: integer("step"),
    path: text("path"),
    device: text("device"),
    props: jsonb("props").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("events_ts_idx").on(t.ts),
    index("events_type_ts_idx").on(t.type, t.ts),
    index("events_visitor_idx").on(t.visitorId),
    index("events_prompt_idx").on(t.promptId),
  ],
);

export const searches = pgTable(
  "searches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    query: text("query").notNull(),
    source: text("source").$type<"widget" | "help_center">().notNull(),
    resultCount: integer("result_count").notNull(),
    aiAnswered: boolean("ai_answered").notNull().default(false),
    helpful: boolean("helpful"),
    clickedArticleId: integer("clicked_article_id"),
    visitorId: text("visitor_id"),
    sessionId: text("session_id"),
    path: text("path"),
  },
  (t) => [index("searches_ts_idx").on(t.ts), index("searches_visitor_idx").on(t.visitorId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
