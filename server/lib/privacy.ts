import crypto from "node:crypto";
import { env } from "../env";

/**
 * Privacy model
 * -------------
 * 1. The host app never sends raw user ids, emails or names. It sends a pseudonymous id it
 *    computed itself, e.g. HMAC_SHA256(HOST_SECRET, user.id). We reject anything that looks
 *    like an email address.
 * 2. We apply our own keyed hash (VISITOR_PEPPER) before storing, so the stored value cannot
 *    be joined back to the host's id without our secret either.
 * 3. No IP addresses, user agent strings or query strings are stored. URLs are reduced to a
 *    path with id-looking segments replaced by ":id".
 * 4. Free text (search queries, element labels, page titles) is scrubbed for emails, phone
 *    numbers, card-like numbers, IPs and long tokens.
 * 5. Traits are filtered against an allowlist and dropped if their value looks like PII.
 * 6. Without analytics consent, events carry no session or visitor id at all: they are only
 *    useful as aggregate counts.
 */

const VISITOR_ID_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export function isValidVisitorId(id: unknown): id is string {
  return typeof id === "string" && VISITOR_ID_RE.test(id) && !id.includes("@");
}

export function pseudonymize(hostVisitorId: string): string {
  return crypto.createHmac("sha256", env.visitorPepper).update(hostVisitorId).digest("hex").slice(0, 32);
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\+?\(?\d(?:[\s().-]{0,2}\d){6,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[A-F0-9]{1,4}:){4,7}[A-F0-9]{1,4}\b/gi;
const LONG_TOKEN_RE = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g;

export function scrubText(input: string, maxLen = 200): string {
  return input
    .slice(0, maxLen * 2)
    .replace(EMAIL_RE, "[email]")
    .replace(IPV4_RE, "[ip]")
    .replace(IPV6_RE, "[ip]")
    .replace(PHONE_RE, "[number]")
    .replace(LONG_TOKEN_RE, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function containsPii(value: string): boolean {
  return scrubText(value, 10_000) !== value.replace(/\s+/g, " ").trim().slice(0, 10_000);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reduce a URL or path to a privacy-safe path: no origin, query, hash, or id-like segments. */
export function sanitizePath(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  let p = input;
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    return null;
  }
  p = p.split(/[?#]/)[0];
  const segments = p
    .split("/")
    .map((s) => {
      if (!s) return s;
      let d = s;
      try {
        d = decodeURIComponent(s);
      } catch {
        /* keep raw */
      }
      if (/^\d+$/.test(d) || UUID_RE.test(d) || d.includes("@") || /^[A-Za-z0-9_-]{20,}$/.test(d) || containsPii(d)) return ":id";
      return s.slice(0, 64);
    })
    .slice(0, 12);
  const out = segments.join("/") || "/";
  return out.startsWith("/") ? out : `/${out}`;
}

type TraitValue = string | number | boolean;

export function sanitizeTraits(traits: unknown, allowlist: string[]): Record<string, TraitValue> {
  const out: Record<string, TraitValue> = {};
  if (!traits || typeof traits !== "object") return out;
  const allowed = new Set(allowlist);
  for (const [k, v] of Object.entries(traits as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 64 && !containsPii(v)) out[k] = v;
  }
  return out;
}

export function sanitizeProps(props: unknown): Record<string, TraitValue> | null {
  if (!props || typeof props !== "object") return null;
  const out: Record<string, TraitValue> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (n++ >= 12 || !/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = scrubText(v, 120);
  }
  return Object.keys(out).length ? out : null;
}

/** Coarse device class only; the user agent string itself is never stored. */
export function deviceClass(ua: string | undefined): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}
