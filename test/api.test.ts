import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "memory://";
delete process.env.ANTHROPIC_API_KEY;
process.env.PRIVACY_API_TOKEN = "test-privacy-token-123";

let base = "";
let server: Server;
let cookie = "";

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body, headers: res.headers };
}

before(async () => {
  const { initDb } = await import("../server/db/client");
  const { createApp } = await import("../server/app");
  await initDb();
  const app = await createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server?.close();
  const { closeDb } = await import("../server/db/client");
  await closeDb();
});

test("first-run setup creates an owner and then locks", async () => {
  let r = await call("/api/admin/auth/me");
  assert.equal(r.body.needsSetup, true);
  assert.equal(r.body.admin, null);
  r = await call("/api/admin/auth/setup", { method: "POST", json: { email: "Owner@Example.com", name: "Owner", password: "correct horse battery" } });
  assert.equal(r.status, 200);
  r = await call("/api/admin/auth/me");
  assert.equal(r.body.admin.role, "owner");
  r = await call("/api/admin/auth/setup", { method: "POST", json: { email: "x@y.com", name: "X", password: "0123456789" } });
  assert.equal(r.status, 409);
});

test("admin API rejects unauthenticated and non-JSON writes", async () => {
  const saved = cookie;
  cookie = "";
  let r = await call("/api/admin/articles");
  assert.equal(r.status, 401);
  cookie = saved;
  r = await call("/api/admin/articles", { method: "POST", body: "title=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(r.status, 415);
});

let articleId = 0;
test("articles: create, publish, sanitize, search, revisions", async () => {
  let r = await call("/api/admin/articles", {
    method: "POST",
    json: { title: "Rotating API keys", summary: "How to rotate keys safely", bodyMd: "## Steps\n\nGo to **Settings → API**.\n\n<script>alert(1)</script>", status: "draft", tags: ["security", "tokens"] },
  });
  assert.equal(r.status, 200);
  articleId = r.body.id;
  assert.equal(r.body.slug, "rotating-api-keys");

  // Drafts are invisible publicly
  r = await call("/api/public/articles/rotating-api-keys");
  assert.equal(r.status, 404);
  r = await call("/api/public/search", { method: "POST", json: { q: "rotate keys", log: false } });
  assert.equal(r.body.hits.length, 0);

  r = await call(`/api/admin/articles/${articleId}`, {
    method: "PUT",
    json: { title: "Rotating API keys", summary: "How to rotate keys safely", bodyMd: "## Steps\n\nGo to **Settings → API** and click Rotate.\n\n<script>alert(1)</script>", status: "published", tags: ["security", "tokens"] },
  });
  assert.equal(r.status, 200);

  r = await call("/api/public/articles/rotating-api-keys");
  assert.equal(r.status, 200);
  assert.ok(!r.body.html.includes("<script"));
  assert.ok(r.body.html.includes('<h2 id="steps">'));

  // prefix + stemming + tag match
  for (const q of ["rotat", "rotating keys", "tokens", "how do I rotate my api key"]) {
    r = await call("/api/public/search", { method: "POST", json: { q } });
    assert.equal(r.body.hits[0]?.slug, "rotating-api-keys", `query "${q}"`);
  }
  r = await call(`/api/admin/articles/${articleId}`);
  assert.equal(r.body.revisions.length, 2);
});

test("events: no consent means no identifiers; consent means pseudonymized ids, sanitized paths and traits", async () => {
  let r = await call("/api/public/events", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ visitorId: "u_should_be_dropped", events: [{ type: "page_view", path: "/a?email=x@y.com" }] }),
  });
  assert.equal(r.status, 202);

  r = await call("/api/public/events", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0 (iPhone) Mobile" },
    body: JSON.stringify({
      sessionId: "a1b2c3d4e5f6a7b8c9d0e1f2",
      visitorId: "u_3f9a1c7e5b2d4a60",
      traits: { plan: "trial", email: "jane@x.com", favourite_color: "blue" },
      events: [
        { type: "page_view", path: "https://app.example.com/users/12345/edit?token=abc" },
        { type: "rage_click", path: "/billing", props: { label: "Pay 4242 4242 4242 4242 jane@x.com" } },
        { type: "not_a_real_type" },
        { type: "article_view", articleSlug: "rotating-api-keys" },
      ],
    }),
  });
  assert.equal(r.body.accepted, 3);

  const { rows } = await import("../server/db/client");
  const { sql } = await import("drizzle-orm");
  const ev = await rows<any>(sql`SELECT * FROM events ORDER BY id`);
  assert.equal(ev[0].visitor_id, null);
  assert.equal(ev[0].session_id, null);
  assert.equal(ev[0].path, "/a");
  const pv = ev[1];
  assert.equal(pv.path, "/users/:id/edit");
  assert.equal(pv.device, "mobile");
  assert.equal(pv.visitor_id.length, 32);
  assert.notEqual(pv.visitor_id, "u_3f9a1c7e5b2d4a60");
  assert.deepEqual(pv.props.traits, { plan: "trial" });
  const rage = ev[2];
  assert.ok(!JSON.stringify(rage.props).includes("4242"));
  assert.ok(!JSON.stringify(rage.props).includes("jane@x.com"));
  assert.equal(ev[3].article_id, articleId);
  const raw = JSON.stringify(ev);
  assert.ok(!raw.includes("127.0.0.1"), "no IP stored");
  assert.ok(!raw.includes("iPhone"), "no user agent stored");
});

test("privacy API: export and erase by host visitor id", async () => {
  let r = await call("/api/privacy/visitors/u_3f9a1c7e5b2d4a60");
  assert.equal(r.status, 401);
  const auth = { Authorization: "Bearer test-privacy-token-123" };
  r = await call("/api/privacy/visitors/u_3f9a1c7e5b2d4a60", { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, 3);
  r = await call("/api/privacy/visitors/u_3f9a1c7e5b2d4a60", { method: "DELETE", headers: auth });
  assert.equal(r.body.eventsDeleted, 3);
  r = await call("/api/privacy/visitors/u_3f9a1c7e5b2d4a60", { headers: auth });
  assert.equal(r.body.events.length, 0);
});

let promptId = 0;
test("prompts: validation, live config, preview tokens", async () => {
  const definition = {
    steps: [{ id: "s1", title: "Hi", body: "Hello **there** <img src=x onerror=alert(1)>", selector: "#x", ctaLabel: "Go", ctaUrl: "javascript:alert(1)" }],
    targeting: { urlRules: [], traitRules: [], audience: "all" },
    trigger: { type: "page_load" },
    frequency: { mode: "once" },
    theme: {},
  };
  let r = await call("/api/admin/prompts", { method: "POST", json: { name: "Bad", type: "tooltip", definition } });
  assert.equal(r.status, 400, "javascript: CTA rejected");

  definition.steps[0].ctaUrl = "/settings";
  r = await call("/api/admin/prompts", { method: "POST", json: { name: "Tip", type: "tooltip", status: "draft", definition } });
  assert.equal(r.status, 200);
  promptId = r.body.id;

  r = await call("/api/public/config");
  assert.equal(r.body.prompts.length, 0, "drafts are not served");

  r = await call(`/api/admin/prompts/${promptId}`, { method: "PUT", json: { name: "Tip", type: "tooltip", status: "live", definition } });
  r = await call("/api/public/config");
  assert.equal(r.body.prompts.length, 1);
  const html = r.body.prompts[0].steps[0].bodyHtml;
  assert.ok(html.includes("<strong>there</strong>"));
  assert.ok(!html.includes("onerror"));
  assert.equal(r.body.ai.overview, false, "AI off without a key");
  assert.equal(r.body.privacy.retentionDays, undefined, "retention not exposed");

  r = await call(`/api/public/preview/${promptId}?token=nope`);
  assert.equal(r.status, 403);
  r = await call(`/api/admin/prompts/${promptId}/preview-link`, { method: "POST", json: { url: "https://app.example.com/page" } });
  const token = new URL(r.body.url).hash.split(".").slice(1).join(".");
  r = await call(`/api/public/preview/${promptId}?token=${encodeURIComponent(token)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, promptId);
});

test("CORS: only allowed origins can post events once configured", async () => {
  let r = await call("/api/admin/settings", { method: "PUT", json: { allowedOrigins: ["https://app.example.com"] } });
  assert.equal(r.status, 200);
  r = await call("/api/public/events", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "text/plain" }, body: JSON.stringify({ events: [] }) });
  assert.equal(r.status, 403);
  r = await call("/api/public/events", { method: "OPTIONS", headers: { Origin: "https://app.example.com" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal(r.headers.get("access-control-allow-credentials"), null, "never credentialed");
});

test("settings validation rejects bad values", async () => {
  const r = await call("/api/admin/settings", { method: "PUT", json: { privacy: { allowedTraits: ["Email Address"] } } });
  assert.equal(r.status, 400);
});

test("nudges fall back to page-pinned articles without an API key", async () => {
  await call(`/api/admin/articles/${articleId}`, {
    method: "PUT",
    json: { title: "Rotating API keys", summary: "How to rotate keys safely", bodyMd: "Rotate.", status: "published", tags: [], contextPaths: ["/settings/api*"] },
  });
  let r = await call("/api/public/nudge", { method: "POST", json: { sessionId: "sess12345678", path: "/settings/api/keys", signals: [{ type: "rage_click", label: "Rotate" }] } });
  assert.equal(r.body.show, true);
  assert.equal(r.body.article.slug, "rotating-api-keys");
  assert.equal(r.body.source, "rules");
  r = await call("/api/public/nudge", { method: "POST", json: { sessionId: "sess12345678", path: "/settings/api/keys", signals: [{ type: "rage_click" }] } });
  assert.equal(r.body.show, false, "cooldown");
});

test("embed bundle is served cross-origin", async () => {
  const r = await call("/embed/kb.js");
  assert.ok([200, 503].includes(r.status));
  assert.equal(r.headers.get("cross-origin-resource-policy"), "cross-origin");
});

test("regression: bodiless DELETE from the admin UI is accepted", async () => {
  const r = await call("/api/admin/collections", { method: "POST", json: { name: "Temp" } });
  const del = await call(`/api/admin/collections/${r.body.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const form = await call(`/api/admin/collections/${r.body.id}`, { method: "DELETE", body: "a=1", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(form.status, 415, "non-JSON bodies still rejected");
});

test("regression: COOP allows the picker popup to keep window.opener", async () => {
  const r = await call("/healthz");
  assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
});

test("regression: help center's own origin passes CORS even when PUBLIC_URL differs", async () => {
  const host = new URL(base).host;
  const r = await call("/api/public/search", { method: "POST", json: { q: "rotate", log: false }, headers: { Origin: `http://${host}` } });
  assert.equal(r.status, 200);
});

test("regression: article feedback and slug lookups resolve per batch", async () => {
  const r = await call("/api/public/events", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ events: [{ type: "article_feedback", articleSlug: "rotating-api-keys", props: { helpful: false } }, { type: "article_view", articleSlug: "does-not-exist" }] }),
  });
  assert.equal(r.body.accepted, 2);
  const { rows } = await import("../server/db/client");
  const { sql } = await import("drizzle-orm");
  const ev = await rows<any>(sql`SELECT type, article_id, props FROM events WHERE type IN ('article_feedback') OR (type = 'article_view' AND article_id IS NULL)`);
  const fb = ev.find((e) => e.type === "article_feedback");
  assert.equal(fb.article_id, articleId);
  assert.equal(fb.props.helpful, false);
  assert.ok(ev.some((e) => e.type === "article_view" && e.article_id === null));
});
