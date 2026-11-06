/**
 * Lumen embed snippet.
 *
 *   <script>
 *     window.kb = window.kb || function () { (kb.q = kb.q || []).push(arguments) };
 *     kb('consent', { analytics: userAcceptedAnalytics });      // from your consent tool
 *     kb('identify', { id: '<pseudonymous id from your backend>', traits: { plan: 'pro' } });
 *   </script>
 *   <script async src="https://kb.example.com/embed/kb.js"></script>
 *
 * Commands: init, identify, consent, track, page, open, close, search, show, reset
 */
import type { EmbedConfig, EmbedPrompt } from "../../shared/types";
import { fetchConfig, flush, track } from "./api";
import { behavior } from "./behavior";
import { h } from "./dom";
import { startPicker } from "./picker";
import { engine } from "./prompts";
import { analyticsAllowed, clearStorage, initSession, randomId, state } from "./state";
import { css } from "./styles";
import { closePanel, isPanelOpen, mountWidget, openPanel, refreshLauncher, showNudge } from "./widget";

type Cmd = [string, ...unknown[]];
type KbFn = ((...args: unknown[]) => void) & { q?: IArguments[] | Cmd[]; loaded?: boolean };

declare global {
  interface Window {
    kb?: KbFn;
    LumenKB?: { version: string };
  }
}

const VERSION = "0.1.0";
let ready = false;
const pending: Cmd[] = [];
let lastPath = "";

function scriptBase(): string {
  const cur = document.currentScript as HTMLScriptElement | null;
  const src = cur?.src || Array.from(document.scripts).find((s) => /\/embed\/kb\.js/.test(s.src))?.src;
  return src ? new URL(src).origin : location.origin;
}

function warn(msg: string) {
  console.warn(`[lumen-kb] ${msg}`);
}

function handle(cmd: Cmd) {
  const [name, arg, extra] = cmd;
  switch (name) {
    case "init": {
      const o = (arg ?? {}) as { baseUrl?: string };
      if (o.baseUrl) state.base = o.baseUrl.replace(/\/$/, "");
      return;
    }
    case "consent": {
      const granted = arg === "granted" || (typeof arg === "object" && arg !== null && (arg as { analytics?: boolean }).analytics === true);
      const was = analyticsAllowed();
      state.consent = granted ? "granted" : "denied";
      if (ready && !was && analyticsAllowed()) initSession();
      if (!granted && ready) {
        // Withdrawing consent: forget the session id so later events are anonymous.
        state.sessionId = randomId();
      }
      return;
    }
    case "identify": {
      const o = (arg ?? {}) as { id?: string; traits?: Record<string, unknown> };
      if (o.id !== undefined) {
        if (typeof o.id !== "string" || o.id.includes("@") || !/^[A-Za-z0-9_\-:.]{8,128}$/.test(o.id)) {
          warn("identify id must be a pseudonymous id (8-128 chars, no emails). Hash your user id on your server, e.g. HMAC-SHA256(secret, userId).");
        } else state.visitorId = o.id;
      }
      if (o.traits && typeof o.traits === "object") {
        const allowed = state.cfg?.privacy.allowedTraits;
        for (const [k, v] of Object.entries(o.traits)) {
          if (!["string", "number", "boolean"].includes(typeof v)) continue;
          if (allowed && !allowed.includes(k)) continue;
          state.traits[k] = v as string | number | boolean;
        }
      }
      if (ready) engine.evaluate();
      return;
    }
    case "track": {
      if (typeof arg !== "string") return;
      track({ type: "custom", name: arg, props: (extra as Record<string, string | number | boolean>) ?? undefined });
      engine.fireCustom(arg);
      return;
    }
    case "page":
      return onRoute(true);
    case "open":
      return openPanel((arg as { article?: string; query?: string }) ?? {});
    case "close":
      return closePanel();
    case "search":
      return openPanel({ query: String(arg ?? "") });
    case "show": {
      const p = state.cfg?.prompts.find((x) => x.id === Number(arg));
      if (p) engine.preview(p);
      return;
    }
    case "reset":
      // Call on logout: drops identity, traits and anything stored in this browser.
      state.visitorId = undefined;
      state.traits = {};
      state.sessionId = randomId();
      clearStorage();
      engine.reset();
      return;
    default:
      warn(`unknown command "${name}"`);
  }
}

function onRoute(force = false) {
  const path = location.pathname;
  if (!force && path === lastPath) return;
  lastPath = path;
  behavior.pageView(path);
  track({ type: "page_view" });
  refreshLauncher();
  engine.evaluate();
}

function watchRoutes() {
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const r = orig.apply(this, args);
      setTimeout(() => onRoute(), 0);
      return r;
    };
  }
  window.addEventListener("popstate", () => onRoute());
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush(true));
}

async function boot() {
  if (window.LumenKB) return; // loaded twice
  window.LumenKB = { version: VERSION };
  state.base = scriptBase();

  // Process queued commands that don't need config (init/consent/identify) right away.
  const queued = (window.kb?.q ?? []) as unknown as ArrayLike<unknown>[];
  for (const args of queued) {
    const cmd = Array.from(args) as Cmd;
    if (["init", "consent", "identify"].includes(cmd[0])) handle(cmd);
    else pending.push(cmd);
  }
  const fn: KbFn = (...args: unknown[]) => (ready ? handle(args as Cmd) : pending.push(args as Cmd));
  fn.loaded = true;
  window.kb = fn;

  let cfg: EmbedConfig;
  try {
    cfg = await fetchConfig();
  } catch (err) {
    warn(`could not load config from ${state.base}: ${(err as Error).message}`);
    return;
  }
  state.cfg = cfg;
  // Re-apply identify now that the trait allowlist is known.
  const allowed = new Set(cfg.privacy.allowedTraits);
  for (const k of Object.keys(state.traits)) if (!allowed.has(k)) delete state.traits[k];
  initSession();

  const host = h("div", { id: "lumen-kb-root" });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(h("style", {}, css), h("div", { class: "kb", style: `--accent:${cfg.launcher.accent}` }));
  document.body.append(host);

  mountWidget(shadow);
  engine.mount(shadow);

  const hash = location.hash;
  const pick = hash.match(/kb-pick=([\w.-]+)/);
  if (pick) {
    state.previewMode = true;
    ready = true;
    startPicker(shadow, pick[1]);
    return;
  }
  const preview = hash.match(/kb-preview=(\d+)\.([\w.-]+)/);
  if (preview) {
    state.previewMode = true;
    const r = await fetch(`${state.base}/api/public/preview/${preview[1]}?token=${encodeURIComponent(preview[2])}`);
    if (r.ok) engine.preview((await r.json()) as EmbedPrompt);
    else warn("preview link expired or invalid");
  }

  behavior.start({
    canNudge: () => !isPanelOpen() && !engine.hasBlocking(),
    onNudge: showNudge,
  });
  ready = true;
  if (!preview) {
    watchRoutes();
    onRoute(true);
  }
  pending.splice(0).forEach(handle);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
