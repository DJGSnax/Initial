import { sql } from "drizzle-orm";
import { rows } from "../db/client";
import type { SearchHit } from "../../shared/types";

/** Turns free text into a prefix-matching tsquery: "reset pass" -> "reset:* & pass:*" */
function toPrefixQuery(q: string, joiner: "&" | "|"): string | null {
  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(` ${joiner} `);
}

interface Row {
  id: number;
  slug: string;
  title: string;
  summary: string;
  snippet: string;
  collection: string | null;
  score: number;
}

async function run(tsq: string, limit: number): Promise<Row[]> {
  return rows<Row>(sql`
    SELECT a.id, a.slug, a.title, a.summary, c.name AS collection,
      ts_rank_cd(a.search_vector, q, 32)::float AS score,
      ts_headline('english', a.body_text, q,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1') AS snippet
    FROM articles a
    LEFT JOIN collections c ON c.id = a.collection_id,
      to_tsquery('english', ${tsq}) q
    WHERE a.status = 'published' AND a.search_vector @@ q
    ORDER BY score DESC, a.updated_at DESC
    LIMIT ${limit}
  `);
}

export async function searchArticles(q: string, limit = 8): Promise<SearchHit[]> {
  const strict = toPrefixQuery(q, "&");
  if (!strict) return [];
  let result = await run(strict, limit);
  // Fall back to any-term matching so long natural-language questions still find articles.
  if (result.length < 3) {
    const loose = toPrefixQuery(q, "|");
    if (loose && loose !== strict) {
      const seen = new Set(result.map((r) => r.id));
      for (const r of await run(loose, limit)) if (!seen.has(r.id)) result.push(r);
      result = result.slice(0, limit);
    }
  }
  return result.map((r) => ({ ...r, score: Number(r.score) }));
}

/** Articles whose context paths match the page the viewer is on. */
export async function articlesForPath(path: string, limit = 5) {
  return rows<{ id: number; slug: string; title: string; summary: string; body_text: string }>(sql`
    SELECT id, slug, title, summary, body_text FROM articles
    WHERE status = 'published' AND EXISTS (
      SELECT 1 FROM unnest(context_paths) p
      WHERE ${path} LIKE replace(replace(p, '%', '\\%'), '*', '%')
    )
    ORDER BY updated_at DESC LIMIT ${limit}
  `);
}

export async function articleBodies(ids: number[]) {
  if (!ids.length) return [];
  return rows<{ id: number; slug: string; title: string; summary: string; body_text: string }>(sql`
    SELECT id, slug, title, summary, body_text FROM articles WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
  `);
}
