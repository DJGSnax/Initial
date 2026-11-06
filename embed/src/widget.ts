import { h, icon, mdLite } from "./dom";
import { getArticle, getContextArticles, search, searchFeedback, streamAnswer, track } from "./api";
import { state } from "./state";
import { matchUrlRules } from "../../shared/targeting";
import type { NudgeResponse, SearchHit } from "../../shared/types";
import { behavior } from "./behavior";

let root: ShadowRoot;
let launcher: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let nudgeEl: HTMLElement | null = null;
let body: HTMLElement;
let input: HTMLInputElement;
let backBtn: HTMLButtonElement;
let answerAbort: AbortController | null = null;
let searchTimer: number | undefined;
let finalTimer: number | undefined;
/** Query already logged and answered by AI, so a pause after Enter doesn't repeat it. */
let finalizedQuery = "";
/** Results view saved when opening an article, restored by Back. */
let savedResults: Node[] | null = null;
let currentSearchId: number | null = null;
let lastQuery = "";

export function isPanelOpen() {
  return !!panel;
}

function side() {
  return state.cfg!.launcher.position === "bottom-left" ? "kb-left" : "kb-right";
}

export function mountWidget(shadow: ShadowRoot) {
  root = shadow;
  refreshLauncher();
}

/** Shows or hides the launcher based on URL rules; called on route changes. */
export function refreshLauncher() {
  const l = state.cfg!.launcher;
  const show = l.enabled && matchUrlRules(l.urlRules, location.pathname);
  if (show && !launcher) {
    launcher = h("button", { class: `kb-launcher ${side()}`, "aria-label": `${l.label} (opens help panel)`, onclick: () => (panel ? closePanel() : openPanel()) }, icon("help"), l.label);
    root.querySelector(".kb")!.append(launcher);
  } else if (!show && launcher) {
    launcher.remove();
    launcher = null;
  }
}

export function openPanel(opts: { article?: string; query?: string } = {}) {
  dismissNudge(false);
  if (!panel) {
    const l = state.cfg!.launcher;
    input = h("input", { type: "search", placeholder: "Search for answers…", "aria-label": "Search help articles", autocomplete: "off" });
    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      clearTimeout(finalTimer);
      // Instant, unlogged results while typing; the logged search and AI overview wait until typing stops.
      searchTimer = window.setTimeout(() => runSearch(input.value, false), 250);
      finalTimer = window.setTimeout(() => runSearch(input.value, true), 1200);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(searchTimer);
        clearTimeout(finalTimer);
        runSearch(input.value, true);
      }
    });
    backBtn = h("button", { class: "kb-x", "aria-label": "Back", style: "display:none", onclick: goBack }, icon("back"));
    body = h("div", { class: "kb-panel-body", role: "region", "aria-live": "polite" });
    panel = h(
      "div",
      { class: `kb-panel ${side()}`, role: "dialog", "aria-label": state.cfg!.siteName },
      h(
        "div",
        { class: "kb-panel-head" },
        h(
          "div",
          { class: "kb-panel-top" },
          h("div", { class: "kb-backbar" }, backBtn, h("p", { class: "kb-panel-title" }, l.greeting)),
          h("button", { class: "kb-x", "aria-label": "Close help", onclick: closePanel }, icon("close")),
        ),
        h("label", { class: "kb-searchbox" }, icon("search"), input),
      ),
      body,
      h(
        "div",
        { class: "kb-panel-foot" },
        h("span", {}, state.cfg!.siteName),
        h("a", { href: `${state.base}/help`, target: "_blank", rel: "noopener" }, "Open help center ", icon("ext")),
      ),
    );
    panel.addEventListener("keydown", (e) => e.key === "Escape" && closePanel());
    root.querySelector(".kb")!.append(panel);
    track({ type: "launcher_open" });
  }
  if (opts.article) showArticle(opts.article);
  else if (opts.query) {
    input.value = opts.query;
    runSearch(opts.query, true);
  } else {
    renderHome();
    setTimeout(() => input.focus(), 50);
  }
}

export function closePanel() {
  answerAbort?.abort();
  clearTimeout(searchTimer);
  clearTimeout(finalTimer);
  panel?.remove();
  panel = null;
  // A reopened panel starts fresh, so the same query can be searched again.
  lastQuery = finalizedQuery = "";
  savedResults = null;
  launcher?.focus();
}

function goBack() {
  backBtn.style.display = "none";
  if (savedResults && lastQuery) body.replaceChildren(...savedResults);
  else renderHome();
  savedResults = null;
}

async function renderHome() {
  lastQuery = "";
  finalizedQuery = "";
  savedResults = null;
  backBtn.style.display = "none";
  body.replaceChildren(h("div", { class: "kb-shimmer", style: "width:40%" }), h("div", { class: "kb-shimmer" }), h("div", { class: "kb-shimmer", style: "width:80%" }));
  const ctx = await getContextArticles().catch(() => []);
  body.replaceChildren(
    ctx.length
      ? h("div", {}, h("p", { class: "kb-section-label" }, "Suggested for this page"), list(ctx.map((a) => ({ slug: a.slug, title: a.title, meta: a.summary }))))
      : h("p", { class: "kb-empty" }, "Search above, or ask a question in your own words."),
  );
}

function list(items: { slug: string; title: string; meta?: string; html?: boolean }[]) {
  return h(
    "ul",
    { class: "kb-list" },
    items.map((it) => {
      const meta = h("div", { class: "kb-item-meta" });
      if (it.html) meta.innerHTML = it.meta ?? "";
      else meta.textContent = it.meta ?? "";
      return h(
        "li",
        {},
        h(
          "button",
          {
            class: "kb-item",
            onclick: () => {
              if (currentSearchId) searchFeedback(currentSearchId, { articleSlug: it.slug });
              showArticle(it.slug);
            },
          },
          h("div", { class: "kb-item-title" }, it.title),
          it.meta ? meta : null,
        ),
      );
    }),
  );
}

/** Snippets come from ts_headline over sanitized plain text; only <mark> survives. */
function safeSnippet(s: string) {
  return s.replace(/<(?!\/?mark>)[^>]*>/g, "").replace(/&(?![a-z#0-9]+;)/gi, "&amp;");
}

async function runSearch(qRaw: string, final: boolean) {
  const q = qRaw.trim();
  if (!q) {
    answerAbort?.abort();
    return renderHome();
  }
  if (q === lastQuery && (!final || q === finalizedQuery)) return;
  answerAbort?.abort();
  lastQuery = q;
  if (final) finalizedQuery = q;
  savedResults = null;
  backBtn.style.display = "none";

  const overview = final && state.cfg!.ai.overview && q.length >= 3 ? h("div", { class: "kb-overview", "aria-busy": "true" }) : null;
  const results = h("div", {});
  body.replaceChildren(...([overview, results].filter(Boolean) as HTMLElement[]));

  let res: { searchId: number | null; hits: SearchHit[] };
  try {
    res = await search(q, final);
  } catch {
    results.replaceChildren(h("p", { class: "kb-empty" }, "Search is unavailable right now."));
    return;
  }
  if (q !== lastQuery) return;
  if (final) {
    currentSearchId = res.searchId;
    behavior.noteSearch(q, res.hits.length);
  }
  results.replaceChildren(
    res.hits.length
      ? h("div", {}, h("p", { class: "kb-section-label" }, "Articles"), list(res.hits.map((x) => ({ slug: x.slug, title: x.title, meta: safeSnippet(x.snippet || x.summary), html: true }))))
      : h("p", { class: "kb-empty" }, `No articles match “${q}”. Try different words.`),
  );
  if (overview) {
    if (!res.hits.length) overview.remove();
    else renderOverview(overview, q, res.searchId);
  }
}

/** The AI answer sits inline above results, like a search engine overview. */
function renderOverview(box: HTMLElement, q: string, searchId: number | null) {
  const label = h("div", { class: "kb-overview-label" }, icon("spark"), "AI overview");
  const text = h("div", { class: "kb-overview-text kb-caret" });
  box.replaceChildren(label, h("div", { class: "kb-shimmer" }), h("div", { class: "kb-shimmer", style: "width:85%" }), h("div", { class: "kb-shimmer", style: "width:60%" }));
  let sources: { n: number; slug: string; title: string }[] = [];
  let full = "";
  answerAbort = new AbortController();
  const render = () => {
    text.innerHTML = mdLite(full, (n) => (sources.find((s) => s.n === n) ? "#" : null));
    text.querySelectorAll<HTMLAnchorElement>(".kb-cite").forEach((a) => {
      const src = sources.find((s) => s.n === Number(a.dataset.cite));
      if (!src) return;
      a.title = src.title;
      a.onclick = (e) => {
        e.preventDefault();
        if (searchId) searchFeedback(searchId, { articleSlug: src.slug });
        showArticle(src.slug);
      };
    });
  };
  streamAnswer(
    q,
    searchId,
    {
      onSources: (s) => (sources = s),
      onDelta: (t) => {
        if (!full) box.replaceChildren(label, text);
        full += t;
        render();
      },
      onDone: (answered) => {
        box.removeAttribute("aria-busy");
        if (!answered || !full) return box.remove();
        text.classList.remove("kb-caret");
        const up = h("button", { "aria-label": "Helpful", "aria-pressed": "false" }, icon("thumbUp"));
        const down = h("button", { "aria-label": "Not helpful", "aria-pressed": "false" }, icon("thumbDown"));
        const vote = (helpful: boolean) => {
          up.setAttribute("aria-pressed", String(helpful));
          down.setAttribute("aria-pressed", String(!helpful));
          if (searchId) searchFeedback(searchId, { helpful });
        };
        up.onclick = () => vote(true);
        down.onclick = () => vote(false);
        box.append(h("div", { class: "kb-overview-foot" }, h("span", {}, "Generated from our articles. Check the sources."), h("span", {}, up, down)));
      },
      onError: () => box.remove(),
    },
    answerAbort.signal,
  );
}

export async function showArticle(slug: string) {
  if (!panel) return openPanel({ article: slug });
  // Keep the results (and any finished AI overview) so Back returns to them without searching again.
  if (lastQuery && !savedResults) savedResults = Array.from(body.childNodes);
  backBtn.style.display = "";
  body.replaceChildren(h("div", { class: "kb-shimmer", style: "width:70%;height:18px" }), h("div", { class: "kb-shimmer" }), h("div", { class: "kb-shimmer" }), h("div", { class: "kb-shimmer", style: "width:50%" }));
  try {
    const a = await getArticle(slug);
    const content = h("div", { class: "kb-article" }, h("h1", {}, a.title));
    const html = h("div", {});
    html.innerHTML = a.html; // sanitized server-side on save
    html.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href")!;
      const m = href.match(/^\/help\/a\/([a-z0-9-]+)/);
      if (m) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          showArticle(m[1]);
        });
      } else if (!/^https?:/.test(href) && !href.startsWith("#")) link.setAttribute("href", `${state.base}${href}`);
    });
    content.append(html);
    if (a.related.length) content.append(h("p", { class: "kb-section-label", style: "margin-top:22px" }, "Related"), list(a.related.map((r) => ({ slug: r.slug, title: r.title }))));
    content.append(h("p", { style: "margin-top:18px" }, h("a", { class: "kb-link", href: `${state.base}/help/a/${a.slug}`, target: "_blank", rel: "noopener" }, "Open in help center ", icon("ext"))));
    body.replaceChildren(content);
    body.scrollTop = 0;
    track({ type: "article_view", articleSlug: slug });
    behavior.noteArticleOpened();
  } catch {
    body.replaceChildren(h("p", { class: "kb-empty" }, "This article isn't available."));
  }
}

// ---------------------------------------------------------------------------
// Nudges: small, dismissible suggestion above the launcher

export function showNudge(n: NudgeResponse) {
  if (!n.show || !n.article || panel || nudgeEl) return;
  const art = n.article;
  nudgeEl = h(
    "div",
    { class: `kb-nudge ${side()}`, role: "status" },
    h("button", { class: "kb-x kb-card-close", "aria-label": "Dismiss suggestion", onclick: () => dismissNudge(true) }, icon("close")),
    h("p", { class: "kb-nudge-msg" }, n.message ?? "This might help:"),
    h(
      "button",
      {
        class: "kb-nudge-article",
        onclick: () => {
          track({ type: "nudge_clicked", articleSlug: art.slug, props: { source: n.source ?? "ai" } });
          nudgeEl?.remove();
          nudgeEl = null;
          openPanel({ article: art.slug });
        },
      },
      h("strong", {}, art.title),
      art.summary ? h("span", {}, art.summary) : null,
    ),
  );
  root.querySelector(".kb")!.append(nudgeEl);
  track({ type: "nudge_shown", articleSlug: art.slug, props: { source: n.source ?? "ai" } });
}

function dismissNudge(byUser: boolean) {
  if (!nudgeEl) return;
  if (byUser) track({ type: "nudge_dismissed" });
  nudgeEl.remove();
  nudgeEl = null;
}
