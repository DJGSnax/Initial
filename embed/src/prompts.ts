import type { EmbedPrompt, PromptStep } from "../../shared/types";
import { matchTargeting } from "../../shared/targeting";
import { h, icon } from "./dom";
import { track } from "./api";
import { getJSON, setJSON, state } from "./state";
import { onReflow, placeCard, waitForElement } from "./position";
import { behavior } from "./behavior";
import { showArticle, isPanelOpen } from "./widget";

/**
 * Prompt engine: picks eligible prompts for the current page, arms their triggers,
 * enforces frequency caps and renders them. Modals and tours are "blocking": one at a time.
 */

interface Seen {
  n: number;
  last: number;
  dismissed?: boolean;
  done?: boolean;
  v?: string;
}

let root: ShadowRoot;
let container: HTMLElement;
const active = new Map<number, () => void>(); // promptId -> teardown
const armed: (() => void)[] = []; // trigger teardowns for this page
let blocking: number | null = null;
const customEventHandlers = new Map<string, (() => void)[]>();

function seenMap() {
  return getJSON<Record<string, Seen>>("kb:seen", {});
}
function sessionShown() {
  return getJSON<number[]>("kb:shown", [], "session");
}

function updateSeen(id: number, patch: Partial<Seen>) {
  const all = seenMap();
  all[id] = { ...(all[id] ?? { n: 0, last: 0 }), ...patch };
  setJSON("kb:seen", all);
}

function frequencyAllows(p: EmbedPrompt): boolean {
  const s = seenMap()[p.id];
  const f = p.frequency;
  if (f.maxImpressions && s && s.n >= f.maxImpressions) return false;
  switch (f.mode) {
    case "once":
      return !s || s.n === 0;
    case "once_per_session":
      return !sessionShown().includes(p.id);
    case "until_dismissed":
      return !s?.dismissed && !s?.done;
    case "every_n_days":
      return !s || Date.now() - s.last > (f.days ?? 7) * 86400_000;
    case "every_time":
    default:
      return true;
  }
}

function eligible(p: EmbedPrompt) {
  return (
    matchTargeting(p.targeting, { path: location.pathname, traits: state.traits, identified: !!state.visitorId }) &&
    frequencyAllows(p)
  );
}

function recordShown(p: EmbedPrompt) {
  const s = seenMap()[p.id];
  updateSeen(p.id, { n: (s?.n ?? 0) + 1, last: Date.now(), v: p.version });
  setJSON("kb:shown", [...new Set([...sessionShown(), p.id])], "session");
  track({ type: "prompt_shown", promptId: p.id });
}

function accentStyle(p: EmbedPrompt) {
  return p.theme.accent ? `--accent:${p.theme.accent}` : "";
}

// ---------------------------------------------------------------------------
// Card content shared by tooltips, modals and tours

function cardContent(p: EmbedPrompt, step: PromptStep, opts: { onClose: () => void; nav?: HTMLElement; dismissible?: boolean }) {
  const bodyEl = h("div", { class: "kb-card-body" });
  bodyEl.innerHTML = step.bodyHtml ?? ""; // rendered + sanitized by the server
  const parts: (HTMLElement | null)[] = [
    opts.dismissible !== false ? h("button", { class: "kb-x kb-card-close", "aria-label": "Close", onclick: opts.onClose }, icon("close")) : null,
    step.title ? h("p", { class: "kb-card-title" }, step.title) : null,
    bodyEl,
  ];
  if (step.articleSlug) {
    parts.push(
      h(
        "button",
        {
          class: "kb-link",
          onclick: () => {
            track({ type: "prompt_cta", promptId: p.id, props: { kind: "article" } });
            showArticle(step.articleSlug!);
          },
        },
        "Read the guide →",
      ),
    );
  }
  if (opts.nav) parts.push(opts.nav);
  return parts.filter(Boolean) as HTMLElement[];
}

function ctaButton(p: EmbedPrompt, step: PromptStep, after: () => void) {
  if (!step.ctaLabel) return null;
  return h(
    "button",
    {
      class: "kb-btn kb-btn-primary",
      onclick: () => {
        track({ type: "prompt_cta", promptId: p.id });
        updateSeen(p.id, { done: true });
        after();
        if (step.ctaUrl) {
          if (step.ctaUrl.startsWith("/")) location.assign(step.ctaUrl);
          else window.open(step.ctaUrl, "_blank", "noopener");
        }
      },
    },
    step.ctaLabel,
  );
}

// ---------------------------------------------------------------------------
// Renderers

async function showAnchored(p: EmbedPrompt, step: PromptStep, close: () => void, nav?: HTMLElement): Promise<(() => void) | null> {
  const target = step.selector ? await waitForElement(step.selector) : null;
  if (step.selector && !target) return null;
  const card = h("div", { class: "kb-card", role: "dialog", "aria-label": step.title || "Tip", style: accentStyle(p) });
  card.append(...cardContent(p, step, { onClose: close, nav, dismissible: p.theme.dismissible }));
  if (target) card.append(h("div", { class: "kb-arrow" }));
  container.append(card);
  if (!target) {
    card.style.left = `${(innerWidth - card.offsetWidth) / 2}px`;
    card.style.top = `${(innerHeight - card.offsetHeight) / 2}px`;
    return () => card.remove();
  }
  target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const place = () => {
    if (!target.isConnected) return;
    placeCard(card, target.getBoundingClientRect(), step.placement);
  };
  place();
  const stop = onReflow(place);
  return () => {
    stop();
    card.remove();
  };
}

function tooltip(p: EmbedPrompt) {
  const step = p.steps[0];
  let teardown: (() => void) | null = null;
  const close = (dismiss = true) => {
    teardown?.();
    active.delete(p.id);
    if (dismiss) {
      updateSeen(p.id, { dismissed: true });
      track({ type: "prompt_dismissed", promptId: p.id });
    }
  };
  const nav = h("div", { class: "kb-card-foot" }, h("span"), h("div", { class: "kb-card-actions" }, ctaButton(p, step, () => close(false)) ?? h("button", { class: "kb-btn kb-btn-primary", onclick: () => close(true) }, "Got it")));
  showAnchored(p, step, () => close(true), nav).then((t) => {
    if (!t) return active.delete(p.id);
    teardown = t;
    recordShown(p);
  });
  active.set(p.id, () => close(false));
}

function hotspot(p: EmbedPrompt) {
  const step = p.steps[0];
  if (!step.selector) return;
  waitForElement(step.selector).then((target) => {
    if (!target || active.has(p.id)) return;
    const beacon = h("button", { class: "kb-beacon", "aria-label": step.title || "Show tip", style: accentStyle(p) });
    container.append(beacon);
    const place = () => {
      const r = target.getBoundingClientRect();
      beacon.style.left = `${r.right - 9}px`;
      beacon.style.top = `${r.top - 9}px`;
      beacon.style.display = r.width ? "" : "none";
    };
    place();
    const stop = onReflow(place);
    let open: (() => void) | null = null;
    beacon.onclick = async () => {
      if (open) return;
      const close = () => {
        open?.();
        open = null;
        teardownAll();
        updateSeen(p.id, { dismissed: true });
        track({ type: "prompt_dismissed", promptId: p.id });
      };
      const nav = h("div", { class: "kb-card-foot" }, h("span"), h("div", { class: "kb-card-actions" }, ctaButton(p, step, () => teardownAll()) ?? h("button", { class: "kb-btn kb-btn-primary", onclick: close }, "Got it")));
      open = await showAnchored(p, step, close, nav);
      recordShown(p);
    };
    const teardownAll = () => {
      stop();
      beacon.remove();
      open?.();
      active.delete(p.id);
    };
    active.set(p.id, teardownAll);
  });
}

function banner(p: EmbedPrompt) {
  const step = p.steps[0];
  const text = h("div", {});
  text.innerHTML = step.bodyHtml || "";
  const top = (p.theme.position ?? "top") === "top";
  const body = document.body;
  const prevPad = body.style.paddingTop;
  const close = (dismiss: boolean) => {
    el.remove();
    ro.disconnect();
    if (top) body.style.paddingTop = prevPad;
    active.delete(p.id);
    if (dismiss) {
      updateSeen(p.id, { dismissed: true });
      track({ type: "prompt_dismissed", promptId: p.id });
    }
  };
  const el = h(
    "div",
    { class: `kb-banner ${p.theme.position ?? "top"}`, role: "region", "aria-label": step.title || "Announcement", style: accentStyle(p) },
    step.title ? h("strong", {}, step.title) : null,
    text,
    ctaButton(p, step, () => close(false)),
    step.articleSlug
      ? h("button", { class: "kb-btn", onclick: () => (track({ type: "prompt_cta", promptId: p.id, props: { kind: "article" } }), showArticle(step.articleSlug!)) }, "Learn more")
      : null,
    p.theme.dismissible !== false ? h("button", { class: "kb-x", "aria-label": "Dismiss", onclick: () => close(true) }, icon("close")) : null,
  );
  container.append(el);
  // Top banners push the page down instead of covering the host app's header.
  // (Headers with position: fixed still need their own offset; sticky headers move with it.)
  const basePad = parseFloat(getComputedStyle(body).paddingTop) || 0;
  const ro = new ResizeObserver(() => {
    if (top) body.style.paddingTop = `${basePad + el.offsetHeight}px`;
  });
  ro.observe(el);
  recordShown(p);
  active.set(p.id, () => close(false));
}

/** Modals and tours share one flow: a sequence of steps, each anchored or centered. */
function sequence(p: EmbedPrompt, startAt = 0) {
  blocking = p.id;
  let index = startAt;
  let teardownStep: (() => void) | null = null;
  let finished = false;
  const progressKey = `kb:tour:${p.id}`;

  const end = (reason: "dismissed" | "completed" | "silent") => {
    if (finished) return;
    finished = true;
    teardownStep?.();
    document.removeEventListener("keydown", onKey, true);
    active.delete(p.id);
    if (blocking === p.id) blocking = null;
    setJSON(progressKey, null, "session");
    if (reason === "completed") {
      updateSeen(p.id, { done: true });
      if (p.type === "tour") track({ type: "tour_completed", promptId: p.id });
    } else if (reason === "dismissed") {
      updateSeen(p.id, { dismissed: true });
      track({ type: "prompt_dismissed", promptId: p.id, step: index });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && p.theme.dismissible !== false) end("dismissed");
  };
  document.addEventListener("keydown", onKey, true);

  const go = async (i: number) => {
    teardownStep?.();
    teardownStep = null;
    index = i;
    if (i >= p.steps.length) return end("completed");
    setJSON(progressKey, i, "session");
    const step = p.steps[i];
    const last = i === p.steps.length - 1;
    if (p.type === "tour") track({ type: "tour_step", promptId: p.id, step: i });

    const nav = h(
      "div",
      { class: "kb-card-foot" },
      p.steps.length > 1 ? h("div", { class: "kb-dots", "aria-label": `Step ${i + 1} of ${p.steps.length}` }, p.steps.map((_, j) => h("span", { class: `kb-dot${j === i ? " on" : ""}` }))) : h("span"),
      h(
        "div",
        { class: "kb-card-actions" },
        i > 0 ? h("button", { class: "kb-btn kb-btn-ghost", onclick: () => go(i - 1) }, "Back") : null,
        last && step.ctaLabel
          ? ctaButton(p, step, () => end("completed"))
          : step.advanceOnClick && step.selector
            ? h("span", { class: "kb-progress" }, "Click the highlighted item")
            : h("button", { class: "kb-btn kb-btn-primary", onclick: () => go(i + 1) }, last ? "Done" : "Next"),
      ),
    );

    if (step.selector) {
      const target = await waitForElement(step.selector, 6000);
      if (finished || index !== i) return;
      if (target) {
        const spot = h("div", { class: `kb-spot${step.spotlight === false ? " no-dim" : ""}` });
        const blocker = step.spotlight !== false && !step.advanceOnClick ? h("div", { class: "kb-blocker" }) : null;
        if (blocker) container.append(blocker);
        container.append(spot);
        const card = h("div", { class: "kb-card", role: "dialog", "aria-modal": "true", "aria-label": step.title || "Tour step", style: accentStyle(p) });
        card.append(...cardContent(p, step, { onClose: () => end("dismissed"), nav, dismissible: p.theme.dismissible }), h("div", { class: "kb-arrow" }));
        container.append(card);
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        const place = () => {
          const r = target.getBoundingClientRect();
          Object.assign(spot.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
          placeCard(card, r, step.placement);
        };
        place();
        setTimeout(place, 350);
        const stop = onReflow(place);
        const clickAdvance = () => setTimeout(() => go(i + 1), 50);
        if (step.advanceOnClick) target.addEventListener("click", clickAdvance, { once: true });
        (card.querySelector(".kb-btn-primary") as HTMLElement | null)?.focus();
        teardownStep = () => {
          stop();
          spot.remove();
          blocker?.remove();
          card.remove();
          target.removeEventListener("click", clickAdvance);
        };
        return;
      }
      // Element not on this page: fall through to a centered card so the flow isn't stuck.
    }

    const modal = h("div", { class: `kb-modal ${p.theme.size ?? "md"}`, role: "dialog", "aria-modal": "true", "aria-label": step.title || "Message" });
    modal.append(...cardContent(p, step, { onClose: () => end("dismissed"), nav, dismissible: p.theme.dismissible }));
    const wrap = h("div", { class: "kb-modal-wrap", style: accentStyle(p) }, modal);
    wrap.addEventListener("click", (e) => e.target === wrap && p.theme.dismissible !== false && end("dismissed"));
    container.append(wrap);
    (modal.querySelector(".kb-btn-primary") as HTMLElement | null)?.focus();
    teardownStep = () => wrap.remove();
  };

  if (startAt === 0) recordShown(p);
  go(startAt);
  active.set(p.id, () => end("silent"));
}

export function render(p: EmbedPrompt) {
  if (active.has(p.id)) return;
  if ((p.type === "modal" || p.type === "tour") && (blocking !== null || isPanelOpen())) return;
  if (p.type === "tooltip") tooltip(p);
  else if (p.type === "hotspot") hotspot(p);
  else if (p.type === "banner") banner(p);
  else sequence(p);
}

// ---------------------------------------------------------------------------
// Triggers

function arm(p: EmbedPrompt) {
  const fire = () => eligible(p) && render(p);
  const t = p.trigger;
  switch (t.type) {
    case "page_load":
      fire();
      break;
    case "delay": {
      const id = setTimeout(fire, t.delayMs ?? 3000);
      armed.push(() => clearTimeout(id));
      break;
    }
    case "scroll": {
      const onScroll = () => {
        const pct = ((scrollY + innerHeight) / document.documentElement.scrollHeight) * 100;
        if (pct >= (t.scrollPct ?? 50)) {
          window.removeEventListener("scroll", onScroll);
          fire();
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      armed.push(() => window.removeEventListener("scroll", onScroll));
      break;
    }
    case "element_click": {
      const onClick = (e: Event) => {
        const el = e.target as Element;
        try {
          if (t.selector && el.closest?.(t.selector)) fire();
        } catch {
          /* bad selector */
        }
      };
      document.addEventListener("click", onClick, true);
      armed.push(() => document.removeEventListener("click", onClick, true));
      break;
    }
    case "custom_event": {
      const name = t.eventName ?? "";
      const list = customEventHandlers.get(name) ?? [];
      list.push(fire);
      customEventHandlers.set(name, list);
      armed.push(() => customEventHandlers.set(name, (customEventHandlers.get(name) ?? []).filter((f) => f !== fire)));
      break;
    }
    case "rage_click":
    case "idle":
      armed.push(behavior.on((type) => type === t.type && fire()));
      break;
    case "repeat_visit":
      if (behavior.visits(location.pathname) >= (t.visits ?? 3)) fire();
      break;
    case "exit_intent": {
      const onOut = (e: MouseEvent) => {
        if (!e.relatedTarget && e.clientY <= 0) {
          document.removeEventListener("mouseout", onOut);
          fire();
        }
      };
      document.addEventListener("mouseout", onOut);
      armed.push(() => document.removeEventListener("mouseout", onOut));
      break;
    }
  }
}

export const engine = {
  mount(shadow: ShadowRoot) {
    root = shadow;
    container = root.querySelector(".kb") as HTMLElement;
  },

  /** Call on each page view. Tears down page-bound prompts and re-arms triggers. */
  evaluate() {
    armed.splice(0).forEach((f) => f());
    for (const [id, teardown] of active) {
      if (id === blocking) continue; // tours survive SPA navigation
      const p = state.cfg!.prompts.find((x) => x.id === id);
      if (!p || !matchTargeting(p.targeting, { path: location.pathname, traits: state.traits, identified: !!state.visitorId })) teardown();
    }
    const prompts = [...state.cfg!.prompts].sort((a, b) => b.priority - a.priority);
    // Resume a tour that was in progress before a full page load.
    for (const p of prompts) {
      const at = getJSON<number | null>(`kb:tour:${p.id}`, null, "session");
      if (at !== null && p.type === "tour" && !active.has(p.id) && blocking === null) sequence(p, at);
    }
    for (const p of prompts) if (!active.has(p.id)) arm(p);
  },

  fireCustom(name: string) {
    (customEventHandlers.get(name) ?? []).forEach((f) => f());
  },

  preview(p: EmbedPrompt) {
    render({ ...p, trigger: { type: "page_load" }, frequency: { mode: "every_time" } });
  },

  hasBlocking() {
    return blocking !== null;
  },

  reset() {
    for (const t of active.values()) t();
    active.clear();
    blocking = null;
  },
};
