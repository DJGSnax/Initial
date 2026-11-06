import type { BehaviorSignal } from "../../shared/types";
import { safeLabel } from "./dom";
import { requestNudge, track } from "./api";
import { getJSON, setJSON, state } from "./state";

/**
 * Detects signs that someone is stuck and turns them into:
 *  1. triggers for admin-defined prompts (rage_click, idle, repeat_visit)
 *  2. an optional AI nudge once the "struggle score" crosses a threshold
 * Nothing here reads form values or keystrokes. Element labels are scrubbed of digits and emails.
 */

type Listener = (type: "rage_click" | "idle" | "repeat_visit", detail?: { count?: number }) => void;

const WEIGHTS: Record<BehaviorSignal["type"], number> = {
  rage_click: 3,
  error_text: 2,
  back_and_forth: 2,
  search_no_click: 2,
  idle: 1,
  repeat_visit: 1,
};
const THRESHOLD = 3;

let listeners: Listener[] = [];
let signals: BehaviorSignal[] = [];
let recentSearches: string[] = [];
let searchesWithoutClick = 0;
let nudgeRequested = false;
let idleTimer: number | undefined;
let interacted = false;
let clicks: { t: number; x: number; y: number }[] = [];
let canNudge: () => boolean = () => false;
let onNudge: (n: Awaited<ReturnType<typeof requestNudge>>) => void = () => {};

function add(sig: BehaviorSignal) {
  const existing = signals.find((s) => s.type === sig.type && s.label === sig.label);
  if (existing) existing.count = (existing.count ?? 1) + (sig.count ?? 1);
  else signals.push({ ...sig, count: sig.count ?? 1 });
  maybeNudge();
}

function score() {
  return signals.reduce((sum, s) => sum + WEIGHTS[s.type] * Math.min(s.count ?? 1, 2), 0);
}

async function maybeNudge() {
  if (nudgeRequested || !state.cfg?.ai.nudges || state.previewMode || score() < THRESHOLD || !canNudge()) return;
  nudgeRequested = true;
  const withHeadings = state.cfg.privacy.nudgeContext === "path_and_headings";
  const headings = withHeadings
    ? Array.from(document.querySelectorAll("h1, h2"))
        .filter((el) => !el.closest("[data-kb-private]"))
        .slice(0, 5)
        .map((el) => (el.textContent ?? "").trim().slice(0, 80))
        .filter(Boolean)
    : [];
  try {
    const n = await requestNudge({
      path: location.pathname,
      title: withHeadings ? document.title.slice(0, 120) : undefined,
      headings,
      signals: signals.slice(0, 10),
      recentSearches: recentSearches.slice(-5),
    });
    if (n.show) onNudge(n);
  } catch {
    /* ignore */
  }
}

function onClick(e: MouseEvent) {
  interacted = true;
  resetIdle();
  const now = performance.now();
  clicks = clicks.filter((c) => now - c.t < 800 && Math.hypot(c.x - e.clientX, c.y - e.clientY) < 40);
  clicks.push({ t: now, x: e.clientX, y: e.clientY });
  if (clicks.length === 3) {
    // At document level e.target is retargeted to the shadow host, so this catches clicks on our own UI
    // (closest() on the inner element can't see past the shadow root).
    if ((e.target as Element | null)?.closest?.("#lumen-kb-root")) return;
    const target = e.composedPath()[0] as Element;
    const label = safeLabel(target instanceof Element ? target : null);
    add({ type: "rage_click", label });
    track({ type: "rage_click", props: label ? { label } : undefined });
    listeners.forEach((l) => l("rage_click"));
  }
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (!interacted || document.hidden) return;
  idleTimer = window.setTimeout(() => {
    add({ type: "idle" });
    track({ type: "idle" });
    listeners.forEach((l) => l("idle"));
  }, idleMs);
}

let idleMs = 45_000;

// Visible error messages (role=alert, aria-invalid) often mean a failed form submit.
const errorObserver = new MutationObserver((muts) => {
  for (const m of muts) {
    const el = m.target instanceof Element ? m.target : null;
    if (!el || el.closest("#lumen-kb-root")) continue;
    const isErr =
      (m.type === "attributes" && m.attributeName === "aria-invalid" && el.getAttribute("aria-invalid") === "true") ||
      (m.type === "childList" && el.matches?.("[role=alert], [aria-live=assertive]") && (el.textContent ?? "").trim().length > 0);
    if (isErr) {
      add({ type: "error_text", label: safeLabel(el) });
      return;
    }
  }
});

export const behavior = {
  start(opts: { canNudge: () => boolean; onNudge: typeof onNudge; idleMs?: number }) {
    canNudge = opts.canNudge;
    onNudge = opts.onNudge;
    if (opts.idleMs) idleMs = opts.idleMs;
    document.addEventListener("click", onClick, true);
    for (const ev of ["keydown", "scroll", "pointermove"]) {
      document.addEventListener(
        ev,
        () => {
          interacted = true;
          resetIdle();
        },
        { passive: true, capture: true },
      );
    }
    document.addEventListener("visibilitychange", resetIdle);
    errorObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-invalid"] });
  },

  on(l: Listener) {
    listeners.push(l);
    return () => (listeners = listeners.filter((x) => x !== l));
  },

  /** Called on every page view (including SPA route changes). Returns the visit count for this path. */
  pageView(path: string): number {
    signals = [];
    nudgeRequested = false;
    interacted = false;
    clearTimeout(idleTimer);
    const visits = getJSON<Record<string, number>>("kb:visits", {}, "session");
    visits[path] = (visits[path] ?? 0) + 1;
    setJSON("kb:visits", visits, "session");
    const trail = getJSON<{ p: string; t: number }[]>("kb:trail", [], "session").filter((x) => Date.now() - x.t < 90_000);
    trail.push({ p: path, t: Date.now() });
    setJSON("kb:trail", trail.slice(-6), "session");
    // A -> B -> A -> B within 90s
    const last4 = trail.slice(-4).map((x) => x.p);
    if (last4.length === 4 && last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) add({ type: "back_and_forth" });
    if (visits[path] >= 3) {
      add({ type: "repeat_visit", count: visits[path] });
      listeners.forEach((l) => l("repeat_visit", { count: visits[path] }));
    }
    return visits[path];
  },

  visits(path: string) {
    return getJSON<Record<string, number>>("kb:visits", {}, "session")[path] ?? 0;
  },

  noteSearch(q: string, hits: number) {
    recentSearches.push(q);
    recentSearches = recentSearches.slice(-5);
    searchesWithoutClick++;
    if (searchesWithoutClick >= 2 || hits === 0) add({ type: "search_no_click" });
  },

  noteArticleOpened() {
    searchesWithoutClick = 0;
  },
};
