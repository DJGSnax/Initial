import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client";
import { articles, collections, events, prompts, searches } from "../db/schema";
import { getSettings } from "../lib/settings";
import { articleBodies, articlesForPath, searchArticles } from "../lib/search";
import { aiAvailable, chooseNudge, streamOverview } from "../lib/ai";
import { verifyToken } from "../lib/auth";
import {
  deviceClass,
  isValidSessionId,
  isValidVisitorId,
  pseudonymize,
  sanitizePath,
  sanitizeProps,
  sanitizeTraits,
  scrubText,
} from "../lib/privacy";
import { env } from "../env";
import { EVENT_TYPES, type EmbedConfig, type EmbedPrompt, type EventBatch, type NudgeRequest, type NudgeResponse, type PromptDefinition } from "../../shared/types";
import { renderMarkdown } from "../lib/markdown";

export const publicRouter = Router();

/** CORS for the embed snippet. No cookies are ever accepted on these routes. */
async function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin) {
    const { allowedOrigins } = await getSettings();
    const ok = allowedOrigins.includes("*") || allowedOrigins.includes(origin) || origin === env.publicUrl || (!env.isProd && allowedOrigins.length === 0);
    if (ok) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    } else if (req.method !== "GET") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

publicRouter.use(cors);
// Rate limiting keys on IP in memory only; the IP is never written anywhere.
publicRouter.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

export function renderDefinition(def: PromptDefinition): PromptDefinition {
  return { ...def, steps: def.steps.map((s) => ({ ...s, bodyHtml: renderMarkdown(s.body) })) };
}

function toEmbed(p: typeof prompts.$inferSelect): EmbedPrompt {
  return {
    id: p.id,
    type: p.type,
    priority: p.priority,
    version: crypto.createHash("sha1").update(p.updatedAt.toISOString()).digest("hex").slice(0, 8),
    ...renderDefinition(p.definition),
  };
}

publicRouter.get("/config", async (_req, res) => {
  const s = await getSettings();
  const live = await db().select().from(prompts).where(eq(prompts.status, "live")).orderBy(desc(prompts.priority));
  const { retentionDays: _r, ...privacy } = s.privacy;
  const cfg: EmbedConfig = {
    siteName: s.siteName,
    baseUrl: env.publicUrl,
    prompts: live.map(toEmbed),
    launcher: s.launcher,
    privacy,
    ai: { overview: s.ai.overview && aiAvailable(), nudges: s.ai.nudges, available: aiAvailable() },
  };
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(cfg);
});

/** Preview a single prompt on a host page, regardless of status or targeting. */
publicRouter.get("/preview/:id", async (req, res) => {
  const tok = verifyToken<{ kind: string; promptId: number }>(String(req.query.token ?? ""));
  if (!tok || tok.kind !== "preview" || tok.promptId !== Number(req.params.id)) return res.status(403).json({ error: "Invalid preview token" });
  const p = await db().query.prompts.findFirst({ where: eq(prompts.id, Number(req.params.id)) });
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(toEmbed(p));
});

publicRouter.post("/pick/verify", async (req, res) => {
  const tok = verifyToken<{ kind: string; origin: string }>(String(req.body?.token ?? ""));
  if (!tok || tok.kind !== "pick") return res.status(403).json({ error: "Invalid token" });
  res.json({ origin: tok.origin });
});

// ---------------------------------------------------------------------------
// Analytics ingestion

const slugCache = new Map<string, number | null>();
async function articleIdForSlug(slug: string | undefined) {
  if (!slug) return null;
  if (slugCache.has(slug)) return slugCache.get(slug)!;
  const a = await db().query.articles.findFirst({ where: eq(articles.slug, slug), columns: { id: true } });
  slugCache.set(slug, a?.id ?? null);
  if (slugCache.size > 2000) slugCache.clear();
  return a?.id ?? null;
}

publicRouter.post("/events", async (req, res) => {
  const body = req.body as EventBatch;
  if (!body || !Array.isArray(body.events)) return res.status(400).json({ error: "Bad batch" });
  const { privacy } = await getSettings();
  // Identifiers are only kept when the snippet says consent was given (it omits them otherwise).
  const sessionId = isValidSessionId(body.sessionId) ? body.sessionId : null;
  const visitorId = sessionId && isValidVisitorId(body.visitorId) ? pseudonymize(body.visitorId) : null;
  const traits = sessionId ? sanitizeTraits(body.traits, privacy.allowedTraits) : {};
  const device = deviceClass(req.headers["user-agent"]);

  const valuesToInsert = [];
  for (const e of body.events.slice(0, 50)) {
    if (!EVENT_TYPES.includes(e.type)) continue;
    const props = sanitizeProps(e.props) ?? {};
    if (e.type === "custom" && e.name) props.name = scrubText(String(e.name), 60);
    if (Object.keys(traits).length && e.type === "page_view") Object.assign(props, { traits });
    valuesToInsert.push({
      type: e.type,
      ts: e.ts && Math.abs(Date.now() - e.ts) < 3600_000 ? new Date(e.ts) : new Date(),
      sessionId,
      visitorId,
      promptId: Number.isInteger(e.promptId) ? e.promptId : null,
      articleId: await articleIdForSlug(e.articleSlug),
      step: Number.isInteger(e.step) ? e.step : null,
      path: sanitizePath(e.path),
      device,
      props: Object.keys(props).length ? props : null,
    });
  }
  if (valuesToInsert.length) await db().insert(events).values(valuesToInsert);
  res.status(202).json({ accepted: valuesToInsert.length });
});

// ---------------------------------------------------------------------------
// Knowledge base reads

publicRouter.get("/collections", async (_req, res) => {
  const cols = await db().select().from(collections).orderBy(asc(collections.position), asc(collections.name));
  const arts = await db()
    .select({ id: articles.id, slug: articles.slug, title: articles.title, summary: articles.summary, collectionId: articles.collectionId })
    .from(articles)
    .where(eq(articles.status, "published"))
    .orderBy(asc(articles.position), asc(articles.title));
  res.json(cols.map((c) => ({ ...c, articles: arts.filter((a) => a.collectionId === c.id) })));
});

publicRouter.get("/articles/:slug", async (req, res) => {
  const a = await db().query.articles.findFirst({
    where: and(eq(articles.slug, req.params.slug), eq(articles.status, "published")),
  });
  if (!a) return res.status(404).json({ error: "Not found" });
  const col = a.collectionId ? await db().query.collections.findFirst({ where: eq(collections.id, a.collectionId) }) : null;
  const related = a.collectionId
    ? await db()
        .select({ slug: articles.slug, title: articles.title })
        .from(articles)
        .where(and(eq(articles.collectionId, a.collectionId), eq(articles.status, "published")))
        .limit(6)
    : [];
  res.json({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    html: a.bodyHtml,
    updatedAt: a.updatedAt,
    tags: a.tags,
    collection: col ? { slug: col.slug, name: col.name } : null,
    related: related.filter((r) => r.slug !== a.slug).slice(0, 5),
  });
});

publicRouter.get("/context", async (req, res) => {
  const path = sanitizePath(String(req.query.path ?? "/")) ?? "/";
  const list = await articlesForPath(path, 5);
  res.json(list.map(({ slug, title, summary }) => ({ slug, title, summary })));
});

function searchMeta(req: Request) {
  const sessionId = isValidSessionId(req.body?.sessionId) ? req.body.sessionId : null;
  return {
    sessionId,
    visitorId: sessionId && isValidVisitorId(req.body?.visitorId) ? pseudonymize(req.body.visitorId) : null,
    source: req.body?.source === "widget" ? ("widget" as const) : ("help_center" as const),
    path: sanitizePath(req.body?.path),
  };
}

/** Instant results. Logged so admins can see what people look for. */
publicRouter.post("/search", async (req, res) => {
  const q = String(req.body?.q ?? "").slice(0, 200).trim();
  if (!q) return res.json({ searchId: null, hits: [] });
  const hits = await searchArticles(q, 8);
  let searchId: number | null = null;
  if (req.body?.log !== false) {
    const [row] = await db()
      .insert(searches)
      .values({ query: scrubText(q, 200), resultCount: hits.length, ...searchMeta(req) })
      .returning({ id: searches.id });
    searchId = row.id;
  }
  res.json({ searchId, hits });
});

/**
 * AI overview, streamed as Server-Sent Events:
 *   event: sources  data: [{n, slug, title}]
 *   event: delta    data: {"text": "..."}
 *   event: done     data: {"answered": true}
 */
publicRouter.post("/answer", aiLimiter, async (req, res) => {
  const { ai } = await getSettings();
  const q = String(req.body?.q ?? "").slice(0, 300).trim();
  if (!q || !ai.overview || !aiAvailable()) return res.status(204).end();

  const hits = await searchArticles(q, 5);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!hits.length) {
    send("done", { answered: false });
    return res.end();
  }
  const bodies = await articleBodies(hits.map((h) => h.id));
  const docs = hits.map((h) => {
    const b = bodies.find((x) => x.id === h.id)!;
    return { id: h.id, slug: h.slug, title: h.title, body: `${b.summary}\n\n${b.body_text}` };
  });
  send("sources", docs.map((d, i) => ({ n: i + 1, slug: d.slug, title: d.title })));

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const result = await streamOverview(q, docs, (text) => send("delta", { text }), abort.signal);
    send("done", { answered: result.answered });
    const searchId = Number(req.body?.searchId);
    if (result.answered && Number.isInteger(searchId)) await db().update(searches).set({ aiAnswered: true }).where(eq(searches.id, searchId));
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("[ai] overview failed:", (err as Error).message);
      send("error", { message: "AI answer unavailable right now" });
    }
  }
  res.end();
});

publicRouter.post("/search/:id/feedback", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).end();
  const patch: Partial<typeof searches.$inferInsert> = {};
  if (typeof req.body?.helpful === "boolean") patch.helpful = req.body.helpful;
  if (typeof req.body?.articleSlug === "string") patch.clickedArticleId = (await articleIdForSlug(req.body.articleSlug)) ?? undefined;
  if (Object.keys(patch).length) await db().update(searches).set(patch).where(eq(searches.id, id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Behavior nudges

const lastNudge = new Map<string, number>();

publicRouter.post("/nudge", aiLimiter, async (req, res) => {
  const body = req.body as NudgeRequest;
  const { ai, privacy } = await getSettings();
  const none: NudgeResponse = { show: false };
  if (!ai.nudges || !isValidSessionId(body?.sessionId) || !Array.isArray(body.signals) || !body.signals.length) return res.json(none);

  // Cooldown per browser session (the session id here is an in-memory value from the page; nothing stored).
  const last = lastNudge.get(body.sessionId) ?? 0;
  if (Date.now() - last < ai.nudgeCooldownMin * 60_000) return res.json(none);

  const path = sanitizePath(body.path) ?? "/";
  const withHeadings = privacy.nudgeContext === "path_and_headings";
  const title = withHeadings && body.title ? scrubText(body.title, 120) : undefined;
  const headings = withHeadings ? (body.headings ?? []).slice(0, 5).map((h) => scrubText(String(h), 80)) : [];
  const recentSearches = (body.recentSearches ?? []).slice(0, 5).map((s) => scrubText(String(s), 80));
  const signals = body.signals.slice(0, 10).map((s) => `${s.type}${s.count ? ` x${s.count}` : ""}${s.label ? ` on "${scrubText(s.label, 60)}"` : ""}`);

  // Candidate articles: pinned to this page first, then full-text matches on page context.
  const pinned = await articlesForPath(path, 4);
  const queryText = [title, ...headings, ...recentSearches, ...body.signals.map((s) => s.label ?? ""), path.replace(/[/:_-]+/g, " ")].filter(Boolean).join(" ");
  const hits = queryText.trim() ? await searchArticles(queryText, 6) : [];
  const ids = [...new Set([...pinned.map((p) => p.id), ...hits.map((h) => h.id)])].slice(0, 6);
  if (!ids.length) return res.json(none);
  const bodies = await articleBodies(ids);
  const candidates = ids.map((id) => bodies.find((b) => b.id === id)!).filter(Boolean);

  lastNudge.set(body.sessionId, Date.now());
  if (lastNudge.size > 50_000) lastNudge.clear();

  let response: NudgeResponse = none;
  if (aiAvailable()) {
    try {
      const pick = await chooseNudge({
        path,
        title,
        headings,
        signals,
        recentSearches,
        candidates: candidates.map((c) => ({ id: c.id, slug: c.slug, title: c.title, body: `${c.summary}\n${c.body_text}` })),
      });
      const chosen = pick?.show ? candidates[pick.source_index - 1] : undefined;
      if (chosen) response = { show: true, message: pick!.message.slice(0, 140), article: { slug: chosen.slug, title: chosen.title, summary: chosen.summary }, source: "ai" };
    } catch (err) {
      console.error("[ai] nudge failed:", (err as Error).message);
    }
  } else {
    // No AI: prefer a page-pinned article that also matches the signals' text, then the best text match, then any pinned one.
    const best = hits.find((h) => pinned.some((p) => p.id === h.id)) ?? (pinned.length ? undefined : hits[0]) ?? pinned[0];
    if (best) response = { show: true, message: "Need a hand with this page?", article: { slug: best.slug, title: best.title, summary: best.summary }, source: "rules" };
  }
  res.json(response);
});

export async function publishedArticleSlugs() {
  return db().select({ slug: articles.slug, title: articles.title }).from(articles).where(eq(articles.status, "published"));
}

