import { test } from "node:test";
import assert from "node:assert/strict";
import { containsPii, isValidVisitorId, sanitizePath, sanitizeTraits, scrubText, deviceClass } from "../server/lib/privacy";
import { matchTargeting, matchUrlRules } from "../shared/targeting";
import { renderMarkdown, htmlToText, slugify } from "../server/lib/markdown";

test("sanitizePath strips origin, query, hash and id-like segments", () => {
  assert.equal(sanitizePath("https://app.example.com/users/12345/edit?token=abc#x"), "/users/:id/edit");
  assert.equal(sanitizePath("/orgs/3f2b8c1e-9a4d-4c3b-8f2e-1a2b3c4d5e6f/settings"), "/orgs/:id/settings");
  assert.equal(sanitizePath("/invite/jane.doe@example.com"), "/invite/:id");
  assert.equal(sanitizePath("/reset/aB3dE5fG7hJ9kL1mN3pQ5rS7"), "/reset/:id");
  assert.equal(sanitizePath("/settings/team"), "/settings/team");
  assert.equal(sanitizePath(""), null);
  assert.equal(sanitizePath(42), null);
});

test("scrubText removes emails, phone numbers, card numbers, IPs and tokens", () => {
  const out = scrubText("mail jane@acme.io or call +1 (555) 123-4567, card 4242 4242 4242 4242 from 10.0.0.1 key tok_fake_abcdefghijklmnopqrstuvwx1");
  assert.ok(!out.includes("jane@acme.io"));
  assert.ok(!out.includes("555"));
  assert.ok(!out.includes("4242"));
  assert.ok(!out.includes("10.0.0.1"));
  assert.ok(!out.includes("tok_fake"));
  assert.equal(scrubText("how do I export a csv"), "how do I export a csv");
});

test("containsPii flags values that would be scrubbed", () => {
  assert.equal(containsPii("pro"), false);
  assert.equal(containsPii("a@b.co"), true);
});

test("sanitizeTraits keeps only allowlisted, non-PII primitives", () => {
  const t = sanitizeTraits({ plan: "pro", role: "admin", email: "x@y.com", name: "Jane", seats: 12, nested: { a: 1 }, locale: "x@y.com" }, ["plan", "role", "seats", "locale", "nested"]);
  assert.deepEqual(t, { plan: "pro", role: "admin", seats: 12 });
});

test("visitor ids must be pseudonymous-looking", () => {
  assert.equal(isValidVisitorId("u_3f9a1c7e5b2d4a60"), true);
  assert.equal(isValidVisitorId("jane@example.com"), false);
  assert.equal(isValidVisitorId("short"), false);
  assert.equal(isValidVisitorId(123), false);
});

test("deviceClass never returns the raw user agent", () => {
  assert.equal(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"), "mobile");
  assert.equal(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "desktop");
  assert.equal(deviceClass(undefined), "unknown");
});

test("URL rules: include, exclude, glob, regex", () => {
  assert.equal(matchUrlRules([], "/anything"), true);
  assert.equal(matchUrlRules([{ op: "starts_with", value: "/settings" }], "/settings/team"), true);
  assert.equal(matchUrlRules([{ op: "starts_with", value: "/settings" }, { op: "equals", value: "/settings/danger", exclude: true }], "/settings/danger"), false);
  assert.equal(matchUrlRules([{ op: "glob", value: "/projects/*/tasks" }], "/projects/:id/tasks"), true);
  assert.equal(matchUrlRules([{ op: "glob", value: "/projects/*" }], "/projects/a/b"), false);
  assert.equal(matchUrlRules([{ op: "glob", value: "/projects/**" }], "/projects/a/b"), true);
  assert.equal(matchUrlRules([{ op: "regex", value: "^/billing(/|$)" }], "/billing"), true);
  assert.equal(matchUrlRules([{ op: "regex", value: "([" }], "/x"), false);
  assert.equal(matchUrlRules([{ op: "equals", value: "/demo" }], "/demo/"), true);
});

test("targeting combines audience, URL and traits", () => {
  const t = { urlRules: [{ op: "starts_with" as const, value: "/app" }], traitRules: [{ key: "plan", op: "in" as const, value: ["trial", "starter"] }, { key: "seats", op: "gt" as const, value: 3 }], audience: "identified" as const };
  assert.equal(matchTargeting(t, { path: "/app/x", traits: { plan: "trial", seats: 5 }, identified: true }), true);
  assert.equal(matchTargeting(t, { path: "/app/x", traits: { plan: "trial", seats: 5 }, identified: false }), false);
  assert.equal(matchTargeting(t, { path: "/app/x", traits: { plan: "business", seats: 5 }, identified: true }), false);
  assert.equal(matchTargeting(t, { path: "/app/x", traits: { plan: "trial", seats: 2 }, identified: true }), false);
});

test("markdown is sanitized: scripts, handlers and javascript: links are removed", () => {
  const html = renderMarkdown(`# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert(1))\n\n<a href="https://ok.example">ok</a>`);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("markdown callouts and heading anchors", () => {
  const html = renderMarkdown("## Set up billing\n\n> [!TIP]\n> Use a card");
  assert.ok(html.includes('<h2 id="set-up-billing">'));
  assert.ok(html.includes('class="callout callout-tip"'));
  assert.equal(htmlToText("<p>a &amp; b</p>"), "a & b");
  assert.equal(slugify("Héllo, World!"), "hello-world");
});
