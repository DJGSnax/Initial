import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { admins, articleRevisions, articles, collections, events, prompts, searches } from "../db/schema";
import { createSession, destroySession, hashPassword, requireAdmin, signToken, verifyPassword } from "../lib/auth";
import { htmlToText, renderMarkdown, slugify } from "../lib/markdown";
import { getSettings, updateSettings } from "../lib/settings";
import { articleSchema, collectionSchema, promptSchema, settingsSchema } from "../lib/validation";
import { aiAvailable, generateInsights } from "../lib/ai";
import { isValidVisitorId, pseudonymize } from "../lib/privacy";
import { renderDefinition } from "./public";
import { env } from "../env";

export const adminRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

// ---------------------------------------------------------------------------
// Auth

adminRouter.get("/auth/me", async (req, res) => {
  const [{ n }] = await db().select({ n: count() }).from(admins);
  res.json({ admin: req.admin ?? null, needsSetup: n === 0, aiAvailable: aiAvailable() });
});

adminRouter.post("/auth/setup", loginLimiter, async (req, res) => {
  const [{ n }] = await db().select({ n: count() }).from(admins);
  if (n > 0) return res.status(409).json({ error: "Already set up" });
  const body = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(10) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Email, name and a password of at least 10 characters are required" });
  const [a] = await db()
    .insert(admins)
    .values({ email: body.data.email.toLowerCase(), name: body.data.name, passwordHash: await hashPassword(body.data.password), role: "owner" })
    .returning();
  await createSession(res, a.id);
  res.json({ ok: true });
});

adminRouter.post("/auth/login", loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? "").toLowerCase();
  const a = await db().query.admins.findFirst({ where: eq(admins.email, email) });
  if (!a || !(await verifyPassword(String(req.body?.password ?? ""), a.passwordHash))) return res.status(401).json({ error: "Wrong email or password" });
  await createSession(res, a.id);
  res.json({ ok: true });
});

adminRouter.post("/auth/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Collections

adminRouter.get("/collections", requireAdmin(), async (_req, res) => {
  const list = await rows(sql`
    SELECT c.*, count(a.id)::int AS article_count FROM collections c
    LEFT JOIN articles a ON a.collection_id = c.id AND a.status <> 'archived'
    GROUP BY c.id ORDER BY c.position, c.name`);
  res.json(list);
});

adminRouter.post("/collections", requireAdmin("editor"), async (req, res) => {
  const p = collectionSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [c] = await db()
    .insert(collections)
    .values({ ...p.data, slug: p.data.slug || slugify(p.data.name) })
    .returning();
  res.json(c);
});

adminRouter.put("/collections/:id", requireAdmin("editor"), async (req, res) => {
  const p = collectionSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [c] = await db()
    .update(collections)
    .set({ ...p.data, slug: p.data.slug || slugify(p.data.name) })
    .where(eq(collections.id, Number(req.params.id)))
    .returning();
  res.json(c);
});

adminRouter.delete("/collections/:id", requireAdmin("editor"), async (req, res) => {
  await db().delete(collections).where(eq(collections.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Articles

adminRouter.get("/articles", requireAdmin(), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "");
  const conds = [];
  if (q) conds.push(or(ilike(articles.title, `%${q}%`), ilike(articles.slug, `%${q}%`)));
  if (status) conds.push(eq(articles.status, status as "draft"));
  else conds.push(ne(articles.status, "archived"));
  const list = await db()
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      status: articles.status,
      collectionId: articles.collectionId,
      updatedAt: articles.updatedAt,
      views: sql<number>`(SELECT count(*)::int FROM events e WHERE e.article_id = ${articles.id} AND e.type = 'article_view' AND e.ts > now() - interval '30 days')`,
    })
    .from(articles)
    .where(and(...conds))
    .orderBy(desc(articles.updatedAt));
  res.json(list);
});

adminRouter.get("/articles/:id", requireAdmin(), async (req, res) => {
  const a = await db().query.articles.findFirst({ where: eq(articles.id, Number(req.params.id)) });
  if (!a) return res.status(404).json({ error: "Not found" });
  const revs = await db()
    .select({ id: articleRevisions.id, title: articleRevisions.title, createdAt: articleRevisions.createdAt, author: admins.name })
    .from(articleRevisions)
    .leftJoin(admins, eq(admins.id, articleRevisions.authorId))
    .where(eq(articleRevisions.articleId, a.id))
    .orderBy(desc(articleRevisions.createdAt))
    .limit(30);
  const { searchVector: _sv, ...rest } = a;
  res.json({ ...rest, revisions: revs });
});

adminRouter.get("/articles/:id/revisions/:rev", requireAdmin(), async (req, res) => {
  const r = await db().query.articleRevisions.findFirst({
    where: and(eq(articleRevisions.id, Number(req.params.rev)), eq(articleRevisions.articleId, Number(req.params.id))),
  });
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json(r);
});

adminRouter.post("/render", requireAdmin(), (req, res) => {
  res.json({ html: renderMarkdown(String(req.body?.md ?? "")) });
});

async function uniqueSlug(base: string, excludeId?: number) {
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await db().query.articles.findFirst({ where: eq(articles.slug, slug), columns: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${i}`;
  }
}

function articleValues(data: z.infer<typeof articleSchema>) {
  const bodyHtml = renderMarkdown(data.bodyMd);
  return { ...data, bodyHtml, bodyText: htmlToText(bodyHtml), keywords: data.tags.join(" "), collectionId: data.collectionId ?? null };
}

adminRouter.post("/articles", requireAdmin("editor"), async (req, res) => {
  const p = articleSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const slug = await uniqueSlug(p.data.slug || slugify(p.data.title));
  const [a] = await db()
    .insert(articles)
    .values({ ...articleValues(p.data), slug, authorId: req.admin!.id, publishedAt: p.data.status === "published" ? new Date() : null })
    .returning({ id: articles.id, slug: articles.slug });
  await db().insert(articleRevisions).values({ articleId: a.id, title: p.data.title, bodyMd: p.data.bodyMd, authorId: req.admin!.id });
  res.json(a);
});

adminRouter.put("/articles/:id", requireAdmin("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const p = articleSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const existing = await db().query.articles.findFirst({ where: eq(articles.id, id) });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const slug = await uniqueSlug(p.data.slug || existing.slug, id);
  await db()
    .update(articles)
    .set({
      ...articleValues(p.data),
      slug,
      updatedAt: new Date(),
      publishedAt: p.data.status === "published" ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
    })
    .where(eq(articles.id, id));
  if (existing.bodyMd !== p.data.bodyMd || existing.title !== p.data.title) {
    await db().insert(articleRevisions).values({ articleId: id, title: p.data.title, bodyMd: p.data.bodyMd, authorId: req.admin!.id });
  }
  res.json({ id, slug });
});

adminRouter.delete("/articles/:id", requireAdmin("editor"), async (req, res) => {
  await db().delete(articles).where(eq(articles.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Prompts

adminRouter.get("/prompts", requireAdmin(), async (_req, res) => {
  const list = await rows(sql`
    SELECT p.id, p.name, p.type, p.status, p.priority, p.updated_at AS "updatedAt", p.definition,
      count(e.*) FILTER (WHERE e.type = 'prompt_shown')::int AS shown,
      count(e.*) FILTER (WHERE e.type IN ('prompt_cta', 'tour_completed'))::int AS converted,
      count(e.*) FILTER (WHERE e.type = 'prompt_dismissed')::int AS dismissed
    FROM prompts p
    LEFT JOIN events e ON e.prompt_id = p.id AND e.ts > now() - interval '30 days'
    WHERE p.status <> 'archived'
    GROUP BY p.id ORDER BY p.status = 'live' DESC, p.updated_at DESC`);
  res.json(list);
});

adminRouter.get("/prompts/:id", requireAdmin(), async (req, res) => {
  const p = await db().query.prompts.findFirst({ where: eq(prompts.id, Number(req.params.id)) });
  if (!p) return res.status(404).json({ error: "Not found" });
  const steps = await rows<{ step: number; n: number }>(sql`
    SELECT step, count(*)::int AS n FROM events
    WHERE prompt_id = ${p.id} AND type = 'tour_step' AND ts > now() - interval '30 days'
    GROUP BY step ORDER BY step`);
  res.json({ ...p, stepFunnel: steps });
});

adminRouter.post("/prompts", requireAdmin("editor"), async (req, res) => {
  const p = promptSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` });
  const [row] = await db().insert(prompts).values(p.data).returning();
  res.json(row);
});

adminRouter.put("/prompts/:id", requireAdmin("editor"), async (req, res) => {
  const p = promptSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` });
  const [row] = await db()
    .update(prompts)
    .set({ ...p.data, updatedAt: new Date() })
    .where(eq(prompts.id, Number(req.params.id)))
    .returning();
  res.json(row);
});

adminRouter.delete("/prompts/:id", requireAdmin("editor"), async (req, res) => {
  await db().delete(prompts).where(eq(prompts.id, Number(req.params.id)));
  res.json({ ok: true });
});

adminRouter.post("/prompts/render", requireAdmin(), (req, res) => {
  const p = promptSchema.shape.definition.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  res.json(renderDefinition(p.data));
});

/** Links that open a host page with the prompt previewed, or with the element picker. */
adminRouter.post("/prompts/:id/preview-link", requireAdmin("editor"), (req, res) => {
  const url = String(req.body?.url ?? "");
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: "Enter a full URL to a page that has the snippet installed" });
  const token = signToken({ kind: "preview", promptId: Number(req.params.id) });
  const u = new URL(url);
  u.hash = `kb-preview=${req.params.id}.${token}`;
  res.json({ url: u.toString() });
});

adminRouter.post("/pick-link", requireAdmin("editor"), (req, res) => {
  const url = String(req.body?.url ?? "");
  const origin = String(req.headers.origin ?? env.publicUrl);
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: "Enter a full URL to a page that has the snippet installed" });
  const token = signToken({ kind: "pick", origin }, 900);
  const u = new URL(url);
  u.hash = `kb-pick=${token}`;
  res.json({ url: u.toString() });
});

// ---------------------------------------------------------------------------
// Analytics

function daysParam(v: unknown) {
  const d = Number(v);
  return Number.isInteger(d) && d > 0 && d <= 365 ? d : 30;
}

adminRouter.get("/analytics/overview", requireAdmin(), async (req, res) => {
  const days = daysParam(req.query.days);
  const since = sql`now() - make_interval(days => ${days})`;
  const [totals] = await rows(sql`
    SELECT
      (SELECT count(*)::int FROM events WHERE type = 'page_view' AND ts > ${since}) AS page_views,
      (SELECT count(DISTINCT visitor_id)::int FROM events WHERE visitor_id IS NOT NULL AND ts > ${since}) AS identified_visitors,
      (SELECT count(DISTINCT session_id)::int FROM events WHERE session_id IS NOT NULL AND ts > ${since}) AS consented_sessions,
      (SELECT count(*)::int FROM events WHERE type = 'article_view' AND ts > ${since}) AS article_views,
      (SELECT count(*)::int FROM searches WHERE ts > ${since}) AS searches,
      (SELECT count(*)::int FROM searches WHERE result_count = 0 AND ts > ${since}) AS zero_result_searches,
      (SELECT count(*)::int FROM searches WHERE ai_answered AND ts > ${since}) AS ai_answers,
      (SELECT count(*)::int FROM searches WHERE helpful IS TRUE AND ts > ${since}) AS helpful_yes,
      (SELECT count(*)::int FROM searches WHERE helpful IS FALSE AND ts > ${since}) AS helpful_no,
      (SELECT count(*)::int FROM events WHERE type = 'prompt_shown' AND ts > ${since}) AS prompts_shown,
      (SELECT count(*)::int FROM events WHERE type IN ('prompt_cta','tour_completed') AND ts > ${since}) AS prompts_converted,
      (SELECT count(*)::int FROM events WHERE type = 'nudge_shown' AND ts > ${since}) AS nudges_shown,
      (SELECT count(*)::int FROM events WHERE type = 'nudge_clicked' AND ts > ${since}) AS nudges_clicked
  `);
  const daily = await rows(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT count(*)::int FROM events WHERE type = 'page_view' AND ts >= d AND ts < d + interval '1 day') AS page_views,
      (SELECT count(*)::int FROM searches WHERE ts >= d AND ts < d + interval '1 day') AS searches,
      (SELECT count(*)::int FROM events WHERE type = 'article_view' AND ts >= d AND ts < d + interval '1 day') AS article_views
    FROM generate_series(date_trunc('day', now()) - make_interval(days => ${days - 1}), date_trunc('day', now()), interval '1 day') d
    ORDER BY d`);
  const topArticles = await rows(sql`
    SELECT a.id, a.slug, a.title,
      count(*) FILTER (WHERE e.type = 'article_view')::int AS views,
      count(*) FILTER (WHERE e.type = 'article_feedback' AND e.props->>'helpful' = 'true')::int AS helpful_yes,
      count(*) FILTER (WHERE e.type = 'article_feedback' AND e.props->>'helpful' = 'false')::int AS helpful_no
    FROM events e JOIN articles a ON a.id = e.article_id
    WHERE e.type IN ('article_view', 'article_feedback') AND e.ts > ${since}
    GROUP BY a.id HAVING count(*) FILTER (WHERE e.type = 'article_view') > 0
    ORDER BY views DESC LIMIT 10`);
  const topSearches = await rows(sql`
    SELECT lower(query) AS query, count(*)::int AS n, round(avg(result_count))::int AS avg_results,
      count(*) FILTER (WHERE clicked_article_id IS NOT NULL)::int AS clicks
    FROM searches WHERE ts > ${since} GROUP BY lower(query) ORDER BY n DESC LIMIT 15`);
  const zeroResults = await rows(sql`
    SELECT lower(query) AS query, count(*)::int AS n FROM searches
    WHERE ts > ${since} AND result_count = 0 GROUP BY lower(query) ORDER BY n DESC LIMIT 15`);
  res.json({ days, totals, daily, topArticles, topSearches, zeroResults });
});

async function behaviorData(days: number) {
  const since = sql`now() - make_interval(days => ${days})`;
  const strugglePages = await rows(sql`
    SELECT path,
      count(*) FILTER (WHERE type = 'rage_click')::int AS rage_clicks,
      count(*) FILTER (WHERE type = 'idle')::int AS idles,
      count(*) FILTER (WHERE type = 'page_view')::int AS views,
      count(*) FILTER (WHERE type = 'launcher_open')::int AS help_opens
    FROM events WHERE ts > ${since} AND path IS NOT NULL
    GROUP BY path HAVING count(*) FILTER (WHERE type IN ('rage_click','idle','launcher_open')) > 0
    ORDER BY (count(*) FILTER (WHERE type = 'rage_click') * 3 + count(*) FILTER (WHERE type IN ('idle','launcher_open'))) DESC
    LIMIT 15`);
  const rageTargets = await rows(sql`
    SELECT path, props->>'label' AS label, count(*)::int AS n FROM events
    WHERE type = 'rage_click' AND ts > ${since} AND props ? 'label'
    GROUP BY path, props->>'label' ORDER BY n DESC LIMIT 15`);
  const searchPages = await rows(sql`
    SELECT path, lower(query) AS query, count(*)::int AS n FROM searches
    WHERE ts > ${since} AND path IS NOT NULL AND source = 'widget'
    GROUP BY path, lower(query) ORDER BY n DESC LIMIT 20`);
  const unhelpful = await rows(sql`
    SELECT lower(query) AS query, count(*)::int AS n FROM searches
    WHERE ts > ${since} AND helpful IS FALSE GROUP BY lower(query) ORDER BY n DESC LIMIT 10`);
  const zeroResults = await rows(sql`
    SELECT lower(query) AS query, count(*)::int AS n FROM searches
    WHERE ts > ${since} AND result_count = 0 GROUP BY lower(query) ORDER BY n DESC LIMIT 15`);
  const promptPerformance = await rows(sql`
    SELECT p.name, p.type,
      count(e.*) FILTER (WHERE e.type = 'prompt_shown')::int AS shown,
      count(e.*) FILTER (WHERE e.type = 'prompt_dismissed')::int AS dismissed,
      count(e.*) FILTER (WHERE e.type IN ('prompt_cta','tour_completed'))::int AS converted
    FROM prompts p JOIN events e ON e.prompt_id = p.id AND e.ts > ${since}
    GROUP BY p.id ORDER BY shown DESC LIMIT 15`);
  const nudges = await rows(sql`
    SELECT path, count(*) FILTER (WHERE type = 'nudge_shown')::int AS shown,
      count(*) FILTER (WHERE type = 'nudge_clicked')::int AS clicked,
      count(*) FILTER (WHERE type = 'nudge_dismissed')::int AS dismissed
    FROM events WHERE ts > ${since} AND type LIKE 'nudge_%' GROUP BY path ORDER BY shown DESC LIMIT 15`);
  return { strugglePages, rageTargets, searchPages, unhelpful, zeroResults, promptPerformance, nudges };
}

adminRouter.get("/analytics/behavior", requireAdmin(), async (req, res) => {
  res.json(await behaviorData(daysParam(req.query.days)));
});

adminRouter.post("/insights", requireAdmin("editor"), async (_req, res) => {
  if (!aiAvailable()) return res.status(400).json({ error: "Set ANTHROPIC_API_KEY to enable AI insights" });
  const data = await behaviorData(30);
  const index = await db().select({ slug: articles.slug, title: articles.title }).from(articles).where(eq(articles.status, "published"));
  try {
    const insights = await generateInsights(data, index);
    if (!insights) return res.status(502).json({ error: "The model declined to produce insights for this data" });
    res.json(insights);
  } catch (err) {
    console.error("[ai] insights failed:", err);
    res.status(502).json({ error: "AI request failed" });
  }
});

// ---------------------------------------------------------------------------
// Settings & team

adminRouter.get("/settings", requireAdmin(), async (_req, res) => {
  res.json({ settings: await getSettings(), publicUrl: env.publicUrl, aiAvailable: aiAvailable(), model: env.aiModel });
});

adminRouter.put("/settings", requireAdmin("owner"), async (req, res) => {
  const p = settingsSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` });
  res.json(await updateSettings(p.data as never));
});

adminRouter.get("/team", requireAdmin(), async (_req, res) => {
  res.json(await db().select({ id: admins.id, email: admins.email, name: admins.name, role: admins.role, createdAt: admins.createdAt }).from(admins).orderBy(asc(admins.createdAt)));
});

adminRouter.post("/team", requireAdmin("owner"), async (req, res) => {
  const body = z
    .object({ email: z.string().email(), name: z.string().min(1), role: z.enum(["owner", "editor", "viewer"]), password: z.string().min(10) })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Email, name, role and a temporary password (10+ chars) are required" });
  const [a] = await db()
    .insert(admins)
    .values({ ...body.data, email: body.data.email.toLowerCase(), passwordHash: await hashPassword(body.data.password) })
    .returning({ id: admins.id });
  res.json(a);
});

adminRouter.delete("/team/:id", requireAdmin("owner"), async (req, res) => {
  if (Number(req.params.id) === req.admin!.id) return res.status(400).json({ error: "You can't remove yourself" });
  await db().delete(admins).where(eq(admins.id, Number(req.params.id)));
  res.json({ ok: true });
});

adminRouter.put("/me/password", requireAdmin(), async (req, res) => {
  const pw = String(req.body?.password ?? "");
  if (pw.length < 10) return res.status(400).json({ error: "Use at least 10 characters" });
  await db().update(admins).set({ passwordHash: await hashPassword(pw) }).where(eq(admins.id, req.admin!.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Data subject requests (GDPR Art. 15 access, Art. 17 erasure)

export async function visitorData(hostVisitorId: string) {
  const vid = pseudonymize(hostVisitorId);
  const ev = await db().select().from(events).where(eq(events.visitorId, vid)).orderBy(desc(events.ts)).limit(5000);
  const se = await db().select().from(searches).where(eq(searches.visitorId, vid)).orderBy(desc(searches.ts)).limit(5000);
  return { storedId: vid, events: ev, searches: se };
}

export async function eraseVisitor(hostVisitorId: string) {
  const vid = pseudonymize(hostVisitorId);
  const e = await db().delete(events).where(eq(events.visitorId, vid)).returning({ id: events.id });
  const s = await db().delete(searches).where(eq(searches.visitorId, vid)).returning({ id: searches.id });
  return { eventsDeleted: e.length, searchesDeleted: s.length };
}

adminRouter.get("/privacy/visitors/:vid", requireAdmin("owner"), async (req, res) => {
  if (!isValidVisitorId(req.params.vid)) return res.status(400).json({ error: "That doesn't look like a visitor id" });
  res.json(await visitorData(req.params.vid));
});

adminRouter.delete("/privacy/visitors/:vid", requireAdmin("owner"), async (req, res) => {
  if (!isValidVisitorId(req.params.vid)) return res.status(400).json({ error: "That doesn't look like a visitor id" });
  res.json(await eraseVisitor(req.params.vid));
});


