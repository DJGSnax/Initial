import type { EmbedConfig, EventBatch, IncomingEvent, NudgeRequest, NudgeResponse, SearchHit } from "../../shared/types";
import { analyticsAllowed, state } from "./state";

/** Each event remembers whether consent existed when it happened, so earlier events never get linked later. */
const queue: { e: IncomingEvent; linked: boolean }[] = [];
let timer: number | undefined;

export async function fetchConfig(): Promise<EmbedConfig> {
  const r = await fetch(`${state.base}/api/public/config`, { credentials: "omit" });
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

function batch(events: IncomingEvent[], linked: boolean): EventBatch {
  if (!linked || !analyticsAllowed()) return { events };
  return { events, sessionId: state.sessionId, visitorId: state.visitorId, traits: state.traits };
}

export function track(e: IncomingEvent) {
  if (state.previewMode) return;
  queue.push({ e: { ...e, ts: Date.now(), path: e.path ?? location.pathname }, linked: analyticsAllowed() });
  if (queue.length >= 20) flush();
  else if (!timer) timer = window.setTimeout(flush, 4000);
}

export function flush(useBeacon = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const items = queue.splice(0, 50);
  const url = `${state.base}/api/public/events`;
  for (const linked of [false, true]) {
    const events = items.filter((i) => i.linked === linked).map((i) => i.e);
    if (!events.length) continue;
    const body = JSON.stringify(batch(events, linked));
    // text/plain avoids a CORS preflight and works with sendBeacon.
    if (useBeacon && navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) continue;
    fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true, credentials: "omit" }).catch(() => {});
  }
  if (queue.length) flush(useBeacon);
}

function ids() {
  return analyticsAllowed() ? { sessionId: state.sessionId, visitorId: state.visitorId } : {};
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${state.base}/api/public${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.status === 204 ? (undefined as T) : r.json();
}

export function search(q: string): Promise<{ searchId: number | null; hits: SearchHit[] }> {
  return post("/search", { q, source: "widget", path: location.pathname, ...ids() });
}

export function searchFeedback(searchId: number, body: { helpful?: boolean; articleSlug?: string }) {
  return post(`/search/${searchId}/feedback`, body).catch(() => {});
}

export async function getArticle(slug: string) {
  const r = await fetch(`${state.base}/api/public/articles/${encodeURIComponent(slug)}`, { credentials: "omit" });
  if (!r.ok) throw new Error("not found");
  return r.json() as Promise<{ slug: string; title: string; html: string; updatedAt: string; related: { slug: string; title: string }[] }>;
}

export async function getContextArticles(): Promise<{ slug: string; title: string; summary: string }[]> {
  const r = await fetch(`${state.base}/api/public/context?path=${encodeURIComponent(location.pathname)}`, { credentials: "omit" });
  return r.ok ? r.json() : [];
}

export function requestNudge(req: Omit<NudgeRequest, "sessionId">): Promise<NudgeResponse> {
  // The session id here is only used for the server's in-memory cooldown, never stored.
  return post("/nudge", { ...req, sessionId: state.sessionId });
}

export interface AnswerHandlers {
  onSources(s: { n: number; slug: string; title: string }[]): void;
  onDelta(text: string): void;
  onDone(answered: boolean): void;
  onError(): void;
}

/** Streams the AI overview (SSE over fetch so we can POST). */
export async function streamAnswer(q: string, searchId: number | null, h: AnswerHandlers, signal: AbortSignal) {
  try {
    const r = await fetch(`${state.base}/api/public/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, searchId }),
      signal,
      credentials: "omit",
    });
    if (r.status === 204 || !r.body) return h.onDone(false);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (!ev || !data) continue;
        const parsed = JSON.parse(data);
        if (ev === "sources") h.onSources(parsed);
        else if (ev === "delta") h.onDelta(parsed.text);
        else if (ev === "done") h.onDone(parsed.answered);
        else if (ev === "error") h.onError();
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") h.onError();
  }
}
