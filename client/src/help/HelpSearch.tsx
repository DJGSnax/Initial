import { useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { streamAnswer } from "../api";
import { cx } from "../ui";
import type { SearchHit } from "@shared/types";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Escapes the model's text, then allows bold, inline code, simple lists and [n] citations. */
function renderAnswer(text: string, sources: { n: number; slug: string; title: string }[]) {
  let html = "";
  let list: "ol" | "ul" | null = null;
  const inline = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[(\d{1,2})\]/g, (_m, n) => {
        const src = sources.find((x) => x.n === Number(n));
        return src ? `<a class="kb-cite" href="/help/a/${src.slug}" title="${esc(src.title)}">${n}</a>` : "";
      });
  for (const raw of esc(text).split(/\n+/)) {
    const line = raw.trim();
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    const kind = ol ? "ol" : ul ? "ul" : null;
    if (kind !== list) {
      if (list) html += `</${list}>`;
      if (kind) html += `<${kind} class="${kind === "ol" ? "list-decimal" : "list-disc"} pl-5 my-2 space-y-1">`;
      list = kind;
    }
    if (kind) html += `<li>${inline((ol ?? ul)![1])}</li>`;
    else if (line) html += `<p class="my-2">${inline(line)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

function safeSnippet(s: string) {
  return s.replace(/<(?!\/?mark>)[^>]*>/g, "");
}

type AnswerState = { status: "idle" | "loading" | "streaming" | "done" | "none"; text: string; sources: { n: number; slug: string; title: string }[] };

export function HelpSearch() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const navigate = useNavigate();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchId, setSearchId] = useState<number | null>(null);
  const [answer, setAnswer] = useState<AnswerState>({ status: "idle", text: "", sources: [] });
  const [vote, setVote] = useState<boolean | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/public/config")
      .then((r) => r.json())
      .then((c) => setAiEnabled(!!c.ai.overview))
      .catch(() => setAiEnabled(false));
  }, []);

  useEffect(() => {
    if (!q || aiEnabled === null) return;
    document.title = `${q} · Search`;
    const ctl = new AbortController();
    setHits(null);
    setVote(null);
    setAnswer({ status: aiEnabled && q.length >= 3 ? "loading" : "none", text: "", sources: [] });
    (async () => {
      const r = await fetch("/api/public/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, source: "help_center" }), signal: ctl.signal });
      const data = (await r.json()) as { searchId: number | null; hits: SearchHit[] };
      setHits(data.hits);
      setSearchId(data.searchId);
      if (!aiEnabled || q.length < 3 || !data.hits.length) return setAnswer((a) => ({ ...a, status: "none" }));
      let text = "";
      let sources: AnswerState["sources"] = [];
      await streamAnswer(
        q,
        data.searchId,
        {
          onSources: (s) => (sources = s),
          onDelta: (t) => {
            text += t;
            setAnswer({ status: "streaming", text, sources });
          },
          onDone: (answered) => setAnswer({ status: answered && text ? "done" : "none", text, sources }),
        },
        ctl.signal,
      );
    })().catch(() => {});
    return () => ctl.abort();
  }, [q, aiEnabled]);

  const click = (slug: string) => {
    if (searchId) fetch(`/api/public/search/${searchId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleSlug: slug }) });
  };
  const sendVote = (helpful: boolean) => {
    setVote(helpful);
    if (searchId) fetch(`/api/public/search/${searchId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ helpful }) });
  };
  const onAnswerClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (href?.startsWith("/help/a/")) {
      e.preventDefault();
      click(href.slice(8));
      navigate(href);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-zinc-500">
        Results for <span className="font-medium text-zinc-900 dark:text-white">“{q}”</span>
      </p>

      {(answer.status === "loading" || answer.status === "streaming" || answer.status === "done") && (
        <section aria-live="polite" aria-busy={answer.status !== "done"} className="mt-5 rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50/80 to-white p-5 dark:border-brand-700/30 dark:from-brand-700/10 dark:to-zinc-900">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-100">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
            </svg>
            AI overview
          </div>
          {answer.status === "loading" ? (
            <div className="space-y-2.5 py-1">
              <div className="shimmer h-3 rounded" />
              <div className="shimmer h-3 w-11/12 rounded" />
              <div className="shimmer h-3 w-2/3 rounded" />
            </div>
          ) : (
            <div onClick={onAnswerClick} className={cx("text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 [&_code]:rounded [&_code]:bg-white/70 [&_code]:px-1 [&_code]:text-[13px] dark:[&_code]:bg-zinc-800", answer.status === "streaming" && "caret")} dangerouslySetInnerHTML={{ __html: renderAnswer(answer.text, answer.sources) }} />
          )}
          {answer.status === "done" && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-100 pt-3 text-xs text-zinc-500 dark:border-brand-700/30">
              <div className="flex flex-wrap gap-1.5">
                {answer.sources
                  .filter((s) => answer.text.includes(`[${s.n}]`))
                  .map((s) => (
                    <Link key={s.n} to={`/help/a/${s.slug}`} onClick={() => click(s.slug)} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-700 hover:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      <span className="font-semibold text-brand-600">{s.n}</span> {s.title}
                    </Link>
                  ))}
              </div>
              <div className="flex items-center gap-1">
                {vote === null ? (
                  <>
                    <span className="mr-1">Helpful?</span>
                    <button onClick={() => sendVote(true)} className="rounded-md px-2 py-1 hover:bg-white dark:hover:bg-zinc-800" aria-label="Helpful">
                      👍
                    </button>
                    <button onClick={() => sendVote(false)} className="rounded-md px-2 py-1 hover:bg-white dark:hover:bg-zinc-800" aria-label="Not helpful">
                      👎
                    </button>
                  </>
                ) : (
                  <span>Thanks for the feedback</span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        {hits === null ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="shimmer h-4 w-1/2 rounded" />
                <div className="shimmer h-3 rounded" />
              </div>
            ))}
          </div>
        ) : hits.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
            <p className="font-medium">No articles match “{q}”</p>
            <p className="mt-1 text-sm text-zinc-500">Try fewer or different words.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {hits.map((h) => (
              <li key={h.id} className="py-4">
                <Link to={`/help/a/${h.slug}`} onClick={() => click(h.slug)} className="group block">
                  {h.collection && <div className="text-xs text-zinc-500">{h.collection}</div>}
                  <div className="text-lg font-semibold text-brand-700 group-hover:underline dark:text-brand-100">{h.title}</div>
                  <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400" dangerouslySetInnerHTML={{ __html: safeSnippet(h.snippet || h.summary) }} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
