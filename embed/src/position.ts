import type { Placement } from "../../shared/types";

export type Side = "top" | "bottom" | "left" | "right";
const GAP = 12;

/** Places `card` next to `rect`, flipping to the side with the most room. Returns the side used. */
export function placeCard(card: HTMLElement, rect: DOMRect, preferred: Placement = "auto"): Side {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const room: Record<Side, number> = { top: rect.top, bottom: vh - rect.bottom, left: rect.left, right: vw - rect.right };
  const fits: Record<Side, boolean> = { top: room.top >= ch + GAP, bottom: room.bottom >= ch + GAP, left: room.left >= cw + GAP, right: room.right >= cw + GAP };
  let side: Side;
  if (preferred !== "auto" && fits[preferred]) side = preferred;
  else side = (["bottom", "top", "right", "left"] as Side[]).find((s) => fits[s]) ?? (room.bottom > room.top ? "bottom" : "top");

  let top = 0;
  let left = 0;
  if (side === "top" || side === "bottom") {
    top = side === "top" ? rect.top - ch - GAP : rect.bottom + GAP;
    left = rect.left + rect.width / 2 - cw / 2;
  } else {
    left = side === "left" ? rect.left - cw - GAP : rect.right + GAP;
    top = rect.top + rect.height / 2 - ch / 2;
  }
  const clampedLeft = Math.max(12, Math.min(left, vw - cw - 12));
  const clampedTop = Math.max(12, Math.min(top, vh - ch - 12));
  card.style.left = `${clampedLeft}px`;
  card.style.top = `${clampedTop}px`;

  const arrow = card.querySelector<HTMLElement>(".kb-arrow");
  if (arrow) {
    arrow.dataset.side = side;
    arrow.style.left = arrow.style.top = "";
    if (side === "top" || side === "bottom") arrow.style.left = `${Math.max(14, Math.min(rect.left + rect.width / 2 - clampedLeft - 6, cw - 26))}px`;
    else arrow.style.top = `${Math.max(14, Math.min(rect.top + rect.height / 2 - clampedTop - 6, ch - 26))}px`;
  }
  return side;
}

export function isVisible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** Resolves when a visible element matching selector exists (SPAs render late), or null after timeout. */
export function waitForElement(selector: string, timeoutMs = 8000): Promise<Element | null> {
  const find = () => {
    try {
      const el = document.querySelector(selector);
      return el && isVisible(el) ? el : null;
    } catch {
      return null;
    }
  };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        obs.disconnect();
        clearTimeout(t);
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    const t = setTimeout(() => {
      obs.disconnect();
      resolve(find());
    }, timeoutMs);
  });
}

/** Calls fn on scroll/resize (throttled to animation frames) until the returned stop() is called. */
export function onReflow(fn: () => void): () => void {
  let raf = 0;
  const handler = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fn);
  };
  window.addEventListener("scroll", handler, true);
  window.addEventListener("resize", handler);
  const ro = new ResizeObserver(handler);
  ro.observe(document.body);
  return () => {
    window.removeEventListener("scroll", handler, true);
    window.removeEventListener("resize", handler);
    ro.disconnect();
    cancelAnimationFrame(raf);
  };
}
