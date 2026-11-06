import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../env";

/**
 * All Claude calls live here.
 * - Overview answers: streamed, low effort for search-bar latency, grounded in our articles only.
 * - Nudges and insights: structured outputs validated with zod.
 * Every call opts into server-side refusal fallbacks ("default" routing).
 */

let client: Anthropic | null = null;
export function aiAvailable() {
  return Boolean(env.anthropicKey);
}
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey });
  return client;
}

const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export interface SourceDoc {
  id: number;
  slug: string;
  title: string;
  body: string;
}

function sourcesBlock(docs: SourceDoc[], maxChars = 6000) {
  return docs.map((d, i) => `<source index="${i + 1}" title="${d.title.replace(/"/g, "'")}">\n${d.body.slice(0, maxChars)}\n</source>`).join("\n\n");
}

const OVERVIEW_SYSTEM = `You write the short answer shown at the top of a help center's search results, above the list of matching articles. Readers glance at it, so lead with the direct answer.

Rules:
- Use only the numbered sources provided. Never add facts, settings, prices or steps that are not in them.
- 2 to 4 sentences, or a short numbered list when the answer is a procedure (max 6 steps). No headings, no preamble like "Based on the sources".
- Cite sources inline with bracketed numbers like [1] or [2] right after the claim they support.
- If the sources do not answer the question, reply with exactly NO_ANSWER and nothing else.
- Plain, friendly language. Do not mention that you are an AI.`;

// Small in-memory cache: identical queries over the same article set reuse the answer for an hour.
const answerCache = new Map<string, { text: string; at: number }>();
const CACHE_MS = 60 * 60 * 1000;

export function overviewCacheKey(query: string, docs: SourceDoc[]) {
  const norm = query.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(norm + "|" + docs.map((d) => d.id).join(",")).digest("hex");
}

export function cachedOverview(key: string) {
  const hit = answerCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  return null;
}

export async function streamOverview(
  query: string,
  docs: SourceDoc[],
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; answered: boolean }> {
  const key = overviewCacheKey(query, docs);
  const cached = cachedOverview(key);
  if (cached !== null) {
    if (cached !== "NO_ANSWER") onText(cached);
    return { text: cached, answered: cached !== "NO_ANSWER" };
  }

  const stream = anthropic().beta.messages.stream(
    {
      model: env.aiModel,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: OVERVIEW_SYSTEM,
      messages: [{ role: "user", content: `${sourcesBlock(docs)}\n\nSearch query: ${query}` }],
      ...FALLBACK,
    },
    { signal },
  );

  // Hold back the first few characters so a NO_ANSWER reply never reaches the reader.
  let full = "";
  let released = false;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      full += event.delta.text;
      if (!released) {
        if (full.length >= 10 || !"NO_ANSWER".startsWith(full.trim())) {
          if (full.trim().startsWith("NO_ANSWER")) continue;
          released = true;
          onText(full);
        }
      } else {
        onText(event.delta.text);
      }
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") return { text: "", answered: false };
  const text = full.trim();
  const answered = text.length > 0 && !text.startsWith("NO_ANSWER");
  if (!released && answered) onText(text);
  answerCache.set(key, { text: answered ? text : "NO_ANSWER", at: Date.now() });
  if (answerCache.size > 500) answerCache.delete(answerCache.keys().next().value!);
  return { text, answered };
}

// ---------------------------------------------------------------------------
// Behavior nudges

const NudgeSchema = z.object({
  show: z.boolean().describe("true only if one source clearly helps with what the user seems stuck on"),
  source_index: z.number().int().describe("1-based index of the best source, or 0 when show is false"),
  message: z.string().describe("One sentence, max 110 characters, shown in a small card. Empathetic, specific, no exclamation marks."),
});

export async function chooseNudge(input: {
  path: string;
  title?: string;
  headings?: string[];
  signals: string[];
  recentSearches: string[];
  candidates: SourceDoc[];
}) {
  const res = await anthropic().beta.messages.parse({
    model: env.aiModel,
    max_tokens: 2000,
    output_config: { effort: "low", format: betaZodOutputFormat(NudgeSchema) },
    system:
      "You decide whether to show a small, dismissible help suggestion inside a web app when behavior suggests the user is stuck. Be conservative: an irrelevant suggestion is worse than none. Only pick a source that directly addresses the task on this page.",
    messages: [
      {
        role: "user",
        content: [
          `Page path: ${input.path}`,
          input.title ? `Page title: ${input.title}` : "",
          input.headings?.length ? `Page headings: ${input.headings.join(" | ")}` : "",
          `Behavior signals: ${input.signals.join("; ") || "none"}`,
          input.recentSearches.length ? `Recent help searches: ${input.recentSearches.join(" | ")}` : "",
          "",
          sourcesBlock(input.candidates, 1500),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  return res.parsed_output;
}

// ---------------------------------------------------------------------------
// Admin insights: turn behavior analytics into content gaps and prompt ideas

const InsightsSchema = z.object({
  summary: z.string().describe("3-5 sentence plain-language read of what users are struggling with"),
  contentGaps: z.array(
    z.object({
      title: z.string(),
      why: z.string().describe("the evidence from the data, citing queries or pages"),
      outline: z.array(z.string()).describe("4-7 section headings for the article"),
    }),
  ),
  promptIdeas: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["tooltip", "hotspot", "modal", "banner", "tour"]),
      path: z.string().describe("URL path or glob where it should appear"),
      trigger: z.enum(["page_load", "delay", "rage_click", "idle", "repeat_visit"]),
      title: z.string(),
      body: z.string().describe("max 200 characters"),
      articleSlug: z.string().describe("slug of an existing article to link, or empty string"),
      why: z.string(),
    }),
  ),
});
export type Insights = z.infer<typeof InsightsSchema>;

export async function generateInsights(data: unknown, articleIndex: { slug: string; title: string }[]): Promise<Insights | null> {
  const res = await anthropic().beta.messages.parse({
    model: env.aiModel,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(InsightsSchema) },
    system:
      "You are a product education analyst. From aggregated, anonymous help-center and in-app behavior data, identify where users struggle and propose specific fixes: articles to write and in-app prompts to show. Ground every recommendation in the numbers given. Prefer a few high-impact ideas over many weak ones (max 5 of each). Only reference article slugs that exist in the index.",
    messages: [
      {
        role: "user",
        content: `Existing articles:\n${articleIndex.map((a) => `- ${a.slug}: ${a.title}`).join("\n")}\n\nBehavior data (last 30 days):\n${JSON.stringify(data, null, 2)}`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}
