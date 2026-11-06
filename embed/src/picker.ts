import { h } from "./dom";
import { state } from "./state";

/** Builds a short, stable, unique CSS selector for an element. */
export function selectorFor(el: Element): string {
  const unique = (sel: string) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const looksGenerated = (v: string) => /\d{3,}|[a-f0-9]{8,}|^(css|sc|jsx|ember)-/i.test(v) || v.length > 40;
  const stableAttr = (e: Element): string | null => {
    for (const attr of ["data-kb-id", "data-testid", "data-test", "data-cy", "data-qa"]) {
      const v = e.getAttribute(attr);
      if (v) return `[${attr}="${CSS.escape(v)}"]`;
    }
    if (e.id && !looksGenerated(e.id)) return `#${CSS.escape(e.id)}`;
    const aria = e.getAttribute("aria-label");
    if (aria && aria.length < 40) return `${e.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
    const name = e.getAttribute("name");
    if (name && !looksGenerated(name)) return `${e.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    return null;
  };

  const own = stableAttr(el);
  if (own && unique(own)) return own;

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const anchor = stableAttr(node);
    if (anchor && parts.length) {
      const candidate = [anchor, ...parts].join(" > ");
      if (unique(candidate)) return candidate;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    const classes = Array.from(node.classList)
      .filter((c) => !looksGenerated(c) && !c.startsWith("kb-"))
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    let part = tag + classes;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    const sel = parts.join(" > ");
    if (unique(sel)) return sel;
    node = parent;
  }
  return parts.join(" > ");
}

/** Element picker opened from the admin app via #kb-pick=<signed token>. */
export async function startPicker(shadow: ShadowRoot, token: string) {
  const r = await fetch(`${state.base}/api/public/pick/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  if (!r.ok) return;
  const { origin } = (await r.json()) as { origin: string };
  const container = shadow.querySelector(".kb")!;
  const box = h("div", { class: "kb-pick-box" });
  const text = h("span", {}, "Click the element the prompt should point at. Esc to cancel.");
  const bar = h("div", { class: "kb-pick-bar" }, text);
  container.append(box, bar);
  let current: Element | null = null;

  const move = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest("#lumen-kb-root")) return;
    current = el;
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const stop = () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    box.remove();
  };
  const click = (e: MouseEvent) => {
    if (!current) return;
    e.preventDefault();
    e.stopPropagation();
    const selector = selectorFor(current);
    stop();
    window.opener?.postMessage({ type: "kb-pick", selector }, origin);
    text.textContent = window.opener ? "Selector sent to the editor. You can close this tab." : "Copy this selector into the editor:";
    bar.append(h("code", {}, selector), h("button", { onclick: () => navigator.clipboard?.writeText(selector) }, "Copy"));
    history.replaceState(null, "", location.pathname + location.search);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      stop();
      bar.remove();
    }
  };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
}
