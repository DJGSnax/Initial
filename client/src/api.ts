export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, json?: unknown) => api<T>(p, { method: "POST", json: json ?? {} });
export const put = <T,>(p: string, json: unknown) => api<T>(p, { method: "PUT", json });
export const del = <T,>(p: string) => api<T>(p, { method: "DELETE" });

/** Streams the AI overview from the public endpoint (same parser as the embed). */
export async function streamAnswer(
  q: string,
  searchId: number | null,
  h: { onSources: (s: { n: number; slug: string; title: string }[]) => void; onDelta: (t: string) => void; onDone: (answered: boolean) => void },
  signal: AbortSignal,
) {
  try {
    const r = await fetch("/api/public/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, searchId }), signal });
    if (r.status === 204 || !r.body) return h.onDone(false);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (!ev || !data) continue;
        const parsed = JSON.parse(data);
        if (ev === "sources") h.onSources(parsed);
        else if (ev === "delta") h.onDelta(parsed.text);
        else if (ev === "done") h.onDone(parsed.answered);
        else if (ev === "error") h.onDone(false);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") h.onDone(false);
  }
}
