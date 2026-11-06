import type { EmbedConfig } from "../../shared/types";

/**
 * Consent and identity.
 * - The host's consent tool is the source of truth: call kb('consent', { analytics: true|false })
 *   on every page load. We do not store a consent decision ourselves.
 * - Without consent: no session id, no visitor id, no traits leave the browser.
 * - Storage: frequency caps and tour progress use localStorage/sessionStorage only when analytics
 *   consent is given, or when the admin set storage to "functional_allowed". Otherwise memory only.
 */

type Consent = "granted" | "denied" | "pending";

const memory = new Map<string, string>();

export const state = {
  cfg: null as EmbedConfig | null,
  base: "",
  consent: "pending" as Consent,
  visitorId: undefined as string | undefined,
  traits: {} as Record<string, string | number | boolean>,
  sessionId: randomId(),
  previewMode: false,
};

export function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function gpcSignal() {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || navigator.doNotTrack === "1";
}

export function analyticsAllowed(): boolean {
  const p = state.cfg?.privacy;
  if (!p || state.previewMode) return false;
  if (state.consent === "granted") return true;
  if (state.consent === "denied") return false;
  if (p.respectGpc && gpcSignal()) return false;
  return !p.requireConsent;
}

export function storageAllowed(): boolean {
  return analyticsAllowed() || state.cfg?.privacy.storage === "functional_allowed";
}

function store(kind: "local" | "session"): Storage | null {
  if (!storageAllowed()) return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getItem(key: string, kind: "local" | "session" = "local"): string | null {
  const s = store(kind);
  try {
    return s ? s.getItem(key) : (memory.get(`${kind}:${key}`) ?? null);
  } catch {
    return memory.get(`${kind}:${key}`) ?? null;
  }
}

export function setItem(key: string, value: string, kind: "local" | "session" = "local") {
  memory.set(`${kind}:${key}`, value);
  const s = store(kind);
  try {
    s?.setItem(key, value);
  } catch {
    /* quota or blocked */
  }
}

export function getJSON<T>(key: string, fallback: T, kind: "local" | "session" = "local"): T {
  try {
    const v = getItem(key, kind);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown, kind: "local" | "session" = "local") {
  setItem(key, JSON.stringify(value), kind);
}

/** Restores a session id across page loads, only when storage is allowed for analytics. */
export function initSession() {
  if (!analyticsAllowed()) return;
  const existing = getItem("kb:sid", "session");
  if (existing && /^[a-f0-9]{24}$/.test(existing)) state.sessionId = existing;
  else setItem("kb:sid", state.sessionId, "session");
}

/** Removes everything the snippet stored in this browser. */
export function clearStorage() {
  memory.clear();
  for (const s of [window.localStorage, window.sessionStorage]) {
    try {
      for (const k of Object.keys(s)) if (k.startsWith("kb:")) s.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
