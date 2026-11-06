# Lumen

An internal knowledge base with an embeddable snippet for in-app guidance.

- **Help center** at `/help`: collections, articles and search. The search bar shows an **AI overview**: a short answer built only from your articles, with numbered citations, sitting above the regular results (no chat popup).
- **Admin** at `/admin`: Markdown editor with live preview and revision history, collections, an in-app prompt builder, analytics, behavior insights, team roles and privacy tools.
- **Embed snippet** (`/embed/kb.js`, ~47 KB minified): one script tag on your product pages adds
  - a help launcher with search, the same inline AI overview, page-specific suggested articles and an article reader
  - **tooltips, hotspots, modals, banners and multi-step product tours**, targeted by URL, user traits and audience, triggered by page load, delay, scroll, clicks, custom events or behavior
  - **behavior-aware nudges**: rage clicks, form errors, idling, repeated searches and back-and-forth navigation raise a "struggle score"; past a threshold, Claude picks the most relevant article and the widget shows a small dismissible card
- **Privacy built in**: no PII, consent-gated identifiers, pseudonymous visitor ids, retention limits, plus export and erasure endpoints. Details below.

## Quick start

```bash
npm install
npm run seed          # demo collections, 10 articles and 4 live prompts
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=pick-a-long-one npm run dev
```

Then open:

| URL | What |
| --- | --- |
| http://localhost:5174/admin | Admin (or skip the env vars and create the owner at the first-run screen) |
| http://localhost:5174/help | Public help center |
| http://localhost:5174/demo | A fake host app with the snippet installed: the welcome tour, banner, hotspot, launcher and nudges all run here |

Without `DATABASE_URL`, the app uses **PGlite** (real Postgres compiled to WASM) in `./data/pglite`, so there's nothing else to install. Set `DATABASE_URL` to use a normal Postgres (Neon, Railway, etc). Migrations run on boot.

To turn on AI, set `ANTHROPIC_API_KEY`. Without it, search still works, the AI overview is hidden, and nudges fall back to articles pinned to the page.

See `.env.example` for every setting.

## Installing the snippet in your product

Settings → Install in the admin has copy-paste code with your URL filled in. The short version:

```html
<script>
  window.kb = window.kb || function () { (kb.q = kb.q || []).push(arguments) };
  kb('consent', { analytics: userAcceptedAnalytics });   // from your consent tool, every page load
  kb('identify', { id: '<pseudonymous id>', traits: { plan: 'pro', role: 'admin' } });
</script>
<script async src="https://kb.yourcompany.com/embed/kb.js"></script>
```

Compute the id **on your server**, never in the browser:

```js
const kbVisitorId = crypto.createHmac("sha256", process.env.KB_IDENTITY_SECRET).update(String(user.id)).digest("hex").slice(0, 32);
```

API: `kb('open')`, `kb('open', { article: 'slug' })`, `kb('search', 'text')`, `kb('track', 'event_name', props)`, `kb('show', promptId)`, `kb('reset')` (call on logout).

Tips for host pages:
- Add `data-kb-id="something"` to elements you want prompts to point at. The element picker prefers it, and it survives redesigns.
- Wrap sensitive UI in `data-kb-private`. The snippet won't read labels or headings inside it.
- The snippet renders in a Shadow DOM, so your CSS can't break it and its CSS can't leak into your app. It follows `pushState` route changes in SPAs.
- Top banners push `body` down so they don't cover your header. Headers with `position: fixed` need their own offset.

### Building prompts

In the admin, In-app prompts → New prompt. Set a **test page URL** where the snippet is installed, then:
- **Pick on page** opens that page in element-picker mode. Click an element and the selector is sent back to the editor (signed, origin-checked `postMessage`).
- **Preview on page** opens the page with that prompt forced on, ignoring targeting and frequency. Preview links expire after 30 minutes and record no analytics.

Live prompts reach the snippet within 30 seconds (config cache).

## Privacy and GDPR

The design goal: analytics useful enough to improve help content, while nothing stored can identify a person by itself.

| | |
| --- | --- |
| **Before consent** | Events are sent with **no session id, visitor id or traits**. They're only usable as aggregate counts. Each event remembers the consent state *at the time it happened*, so accepting later never links earlier events. Global Privacy Control and Do Not Track count as a refusal unless the user explicitly consents. |
| **Identity** | The host app sends a pseudonymous id it computed with its own secret. Lumen rejects anything that looks like an email and **HMACs the id again** with `VISITOR_PEPPER` before storing it. Neither side alone can reverse it. |
| **Never stored** | IP addresses (rate limiting keeps them in memory only), user agent strings (only mobile/tablet/desktop), query strings, URL fragments, form values, keystrokes. |
| **Paths** | Numeric ids, UUIDs, emails and long tokens in URL paths become `:id`. |
| **Traits** | Only keys on the admin allowlist are kept, filtered in the browser and again on the server. Values that look like emails, phone numbers or tokens are dropped. |
| **Free text** | Search queries, element labels and page headings are scrubbed of emails, phone numbers, card-like numbers, IPs and tokens. |
| **Storage** | Frequency caps and tour progress use localStorage/sessionStorage. Admins choose whether that's allowed before consent ("functional") or memory-only until consent. `kb('reset')` clears it. |
| **Retention** | Events and searches older than the retention window (default 180 days) are deleted automatically. |
| **Access & erasure** | Settings → Data requests exports or deletes everything linked to a visitor id. For automation, set `PRIVACY_API_TOKEN` and call `GET` or `DELETE /api/privacy/visitors/:id` from your account-deletion flow. |
| **AI** | Only published article text, the search query and scrubbed page context go to the model. Nudge context can be limited to the URL path. |

This gives you a defensible setup, not a legal opinion. Your consent banner wording, privacy policy and DPA with Anthropic still need to be handled on your side.

## How the AI parts work

All Claude calls are in `server/lib/ai.ts`. Each one uses `claude-opus-5-5` (override with `AI_MODEL`) and opts into server-side refusal fallbacks (`fallbacks: "default"`).

- **Overview**: Postgres full-text search finds the top 5 articles, and their text is sent as numbered sources. The answer streams over SSE at low effort to keep search-bar latency down. If the sources don't answer the question, the model replies `NO_ANSWER` and the box is hidden. That token is held back while streaming, so it never flashes on screen. Answers are cached in memory for an hour per query and article set.
- **Nudges**: candidates are articles pinned to the page path, plus full-text matches on the page title, headings, recent searches and rage-clicked labels. Claude returns structured output (`show`, `source_index`, `message`) and is told to be conservative. There's a cooldown per session (default 10 minutes).
- **Insights** (Behavior & AI page): 30 days of aggregates (struggle pages, rage-clicked elements, searches by page, zero-result and unhelpful queries, prompt performance) are turned into article outlines and prompt ideas. Each one has a "Create draft" button.

## Project layout

```
server/            Express API (TypeScript)
  db/              Drizzle schema, migrations, Postgres/PGlite client
  lib/             privacy, search, markdown sanitizing, auth, AI, settings
  routes/          admin API (session auth) and public API (CORS, no cookies)
client/            React admin + help center (Vite, Tailwind)
embed/src/         The snippet: widget, prompt engine, behavior detection, element picker
shared/            Types and targeting logic used by all three
scripts/           Embed build, demo host page
test/              node:test unit + API integration tests (in-memory PGlite)
```

## Scripts

| | |
| --- | --- |
| `npm run dev` | API + Vite (one port) + embed watcher |
| `npm test` | Unit and integration tests |
| `npm run typecheck` | TypeScript across everything |
| `npm run build` / `npm start` | Production build and server |
| `npm run seed` | Demo content (safe to re-run) |
| `npm run db:generate` | New migration after editing `server/db/schema.ts` |

## Deploying

Any Node 20+ host works. For Railway (like the other projects): add a Postgres plugin, set `DATABASE_URL`, `PUBLIC_URL`, `APP_SECRET`, `VISITOR_PEPPER` and optionally `ANTHROPIC_API_KEY`, with build command `npm run build` and start command `npm start`. In production the server refuses to start without real secrets. Add your app's origins under Settings → Install → Allowed origins.

## Known limits and next steps

- Frequency caps live in the browser, so a user on two devices can see a prompt twice. Server-side caps for identified users would fix that.
- The help center is a client-rendered SPA. Server-side rendering of article pages would help SEO if the help center goes public.
- Search is Postgres full-text (stemming, prefix and any-term fallback). Embeddings would improve matching for questions phrased very differently from the articles.
- Single workspace by design. Multi-tenant would need a workspace id on every table and per-tenant site keys.
- No A/B testing of prompts yet. The event model supports it (add a variant prop).
