export const css = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
.kb {
  --accent: #4f46e5;
  --accent-fg: #fff;
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --bg-hover: #eef0f4;
  --fg: #16181d;
  --fg-muted: #5c6370;
  --border: #e3e6eb;
  --shadow: 0 12px 40px rgba(15, 18, 30, .18), 0 2px 8px rgba(15, 18, 30, .08);
  --radius: 14px;
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .kb {
    --bg: #17191f; --bg-soft: #1f222a; --bg-hover: #282c36; --fg: #eceef2; --fg-muted: #a0a7b4;
    --border: #2e323c; --shadow: 0 12px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
  }
}
.kb-icon { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
a { color: var(--accent); }

/* ---------- buttons ---------- */
.kb-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9px; font-weight: 600; font-size: 13px; transition: background .15s, transform .1s; }
.kb-btn:active { transform: scale(.98); }
.kb-btn-primary { background: var(--accent); color: var(--accent-fg); }
.kb-btn-primary:hover { filter: brightness(1.08); }
.kb-btn-ghost { color: var(--fg-muted); }
.kb-btn-ghost:hover { background: var(--bg-hover); color: var(--fg); }
.kb-x { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--fg-muted); }
.kb-x:hover { background: var(--bg-hover); color: var(--fg); }

/* ---------- launcher ---------- */
.kb-launcher { position: fixed; bottom: 20px; z-index: 2147483000; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px 0 14px;
  border-radius: 999px; background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow); font-weight: 600; font-size: 14px; transition: transform .15s; }
.kb-launcher:hover { transform: translateY(-1px); }
.kb-right { right: 20px; } .kb-left { left: 20px; }

/* ---------- panel ---------- */
.kb-panel { position: fixed; bottom: 80px; z-index: 2147483001; width: 400px; max-width: calc(100vw - 32px); height: 640px; max-height: calc(100vh - 110px);
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden;
  animation: kb-pop .18s ease-out; }
@media (max-width: 480px) { .kb-panel { left: 0 !important; right: 0 !important; bottom: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; } }
@keyframes kb-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.kb-panel-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--border); }
.kb-panel-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.kb-panel-title { font-weight: 700; font-size: 16px; margin: 0; }
.kb-searchbox { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-soft); color: var(--fg-muted); }
.kb-searchbox:focus-within { border-color: var(--accent); background: var(--bg); }
.kb-searchbox input { all: unset; flex: 1; font-size: 14px; color: var(--fg); }
.kb-searchbox input::placeholder { color: var(--fg-muted); }
.kb-panel-body { flex: 1; overflow-y: auto; padding: 14px 16px 18px; overscroll-behavior: contain; }
.kb-panel-foot { padding: 10px 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--fg-muted); display: flex; justify-content: space-between; align-items: center; }
.kb-panel-foot a { color: var(--fg-muted); text-decoration: none; display: inline-flex; gap: 4px; align-items: center; }
.kb-panel-foot a:hover { color: var(--fg); }
.kb-section-label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-muted); margin: 4px 0 8px; }

/* ---------- AI overview (inline, not a chat) ---------- */
.kb-overview { border: 1px solid var(--border); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--bg)), var(--bg)); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
.kb-overview-label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 6px; }
.kb-overview-text { font-size: 14px; }
.kb-overview-text p { margin: 0 0 6px; }
.kb-overview-text ol, .kb-overview-text ul { margin: 4px 0 6px; padding-left: 20px; }
.kb-overview-text li { margin: 2px 0; }
.kb-overview-text code { font-size: 12.5px; background: var(--bg-hover); padding: 1px 5px; border-radius: 5px; }
.kb-cite { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; margin: 0 1px; border-radius: 5px; font-size: 10.5px; font-weight: 700;
  background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); text-decoration: none; vertical-align: 1px; }
.kb-cite:hover { background: var(--accent); color: var(--accent-fg); }
.kb-overview-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--fg-muted); }
.kb-overview-foot button { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; color: var(--fg-muted); }
.kb-overview-foot button:hover, .kb-overview-foot button[aria-pressed=true] { background: var(--bg-hover); color: var(--fg); }
.kb-shimmer { height: 10px; border-radius: 6px; margin: 7px 0; background: linear-gradient(90deg, var(--bg-hover) 0%, var(--bg-soft) 50%, var(--bg-hover) 100%); background-size: 200% 100%; animation: kb-sh 1.2s linear infinite; }
@keyframes kb-sh { to { background-position: -200% 0; } }
.kb-caret::after { content: ""; display: inline-block; width: 6px; height: 14px; margin-left: 2px; vertical-align: -2px; background: var(--accent); animation: kb-blink 1s steps(2) infinite; }
@keyframes kb-blink { 50% { opacity: 0; } }

/* ---------- result list ---------- */
.kb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.kb-item { display: block; width: 100%; text-align: left; padding: 10px 10px; border-radius: 9px; }
.kb-item:hover, .kb-item:focus-visible { background: var(--bg-hover); }
.kb-item-title { font-weight: 600; font-size: 14px; color: var(--fg); }
.kb-item-meta { font-size: 12.5px; color: var(--fg-muted); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.kb-item-meta mark { background: color-mix(in srgb, var(--accent) 18%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.kb-empty { text-align: center; color: var(--fg-muted); padding: 24px 8px; font-size: 13px; }

/* ---------- article ---------- */
.kb-article h1 { font-size: 20px; line-height: 1.3; margin: 4px 0 12px; }
.kb-article h2 { font-size: 16px; margin: 20px 0 8px; }
.kb-article h3 { font-size: 14.5px; margin: 16px 0 6px; }
.kb-article p, .kb-article li { font-size: 14px; }
.kb-article img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }
.kb-article pre { background: var(--bg-soft); padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; }
.kb-article code { font-size: 12.5px; background: var(--bg-soft); padding: 1px 4px; border-radius: 4px; }
.kb-article pre code { background: none; padding: 0; }
.kb-article blockquote { margin: 12px 0; padding: 8px 12px; border-left: 3px solid var(--border); color: var(--fg-muted); background: var(--bg-soft); border-radius: 0 8px 8px 0; }
.kb-article blockquote.callout-tip { border-color: #16a34a; } .kb-article blockquote.callout-warning { border-color: #d97706; } .kb-article blockquote.callout-note { border-color: var(--accent); }
.kb-article table { border-collapse: collapse; width: 100%; font-size: 13px; } .kb-article th, .kb-article td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
.kb-backbar { display: flex; align-items: center; gap: 6px; }

/* ---------- step card (tooltip, modal, tour) ---------- */
.kb-card { position: fixed; z-index: 2147483002; width: 320px; max-width: calc(100vw - 24px); background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: var(--shadow); padding: 16px; animation: kb-pop .18s ease-out; }
.kb-card-title { font-weight: 700; font-size: 15px; margin: 0 28px 6px 0; }
.kb-card-body { font-size: 13.5px; color: var(--fg-muted); }
.kb-card-body p { margin: 0 0 8px; } .kb-card-body p:last-child { margin-bottom: 0; }
.kb-card-body img { max-width: 100%; border-radius: 8px; }
.kb-card-close { position: absolute; top: 10px; right: 10px; }
.kb-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 14px; }
.kb-card-actions { display: flex; gap: 6px; margin-left: auto; }
.kb-dots { display: flex; gap: 5px; } .kb-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--border); } .kb-dot.on { background: var(--accent); width: 16px; }
.kb-progress { font-size: 12px; color: var(--fg-muted); }
.kb-link { font-size: 13px; font-weight: 600; color: var(--accent); display: inline-flex; gap: 4px; align-items: center; margin-top: 8px; }
.kb-link:hover { text-decoration: underline; }
.kb-arrow { position: absolute; width: 12px; height: 12px; background: var(--bg); border: 1px solid var(--border); transform: rotate(45deg); }
.kb-arrow[data-side=top] { bottom: -7px; border-top: 0; border-left: 0; }
.kb-arrow[data-side=bottom] { top: -7px; border-bottom: 0; border-right: 0; }
.kb-arrow[data-side=left] { right: -7px; border-bottom: 0; border-left: 0; }
.kb-arrow[data-side=right] { left: -7px; border-top: 0; border-right: 0; }

.kb-modal-wrap { position: fixed; inset: 0; z-index: 2147483002; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(10, 12, 20, .45); animation: kb-fade .15s; }
@keyframes kb-fade { from { opacity: 0; } }
.kb-modal { position: relative; width: 460px; max-width: 100%; max-height: calc(100vh - 32px); overflow-y: auto; background: var(--bg); border-radius: 16px; box-shadow: var(--shadow); padding: 24px; animation: kb-pop .2s ease-out; }
.kb-modal.sm { width: 360px; } .kb-modal.lg { width: 640px; }
.kb-modal .kb-card-title { font-size: 19px; margin-bottom: 8px; }
.kb-modal .kb-card-body { font-size: 14.5px; }

.kb-spot { position: fixed; z-index: 2147483001; border-radius: 8px; pointer-events: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent), 0 0 0 9999px rgba(10, 12, 20, .45); transition: all .2s ease; }
.kb-spot.no-dim { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent); }
.kb-blocker { position: fixed; inset: 0; z-index: 2147483000; }

/* ---------- banner ---------- */
.kb-banner { position: fixed; left: 0; right: 0; z-index: 2147482999; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 10px 48px 10px 16px;
  background: var(--accent); color: var(--accent-fg); font-size: 14px; box-shadow: 0 2px 10px rgba(0,0,0,.12); animation: kb-fade .2s; flex-wrap: wrap; text-align: center; }
.kb-banner.top { top: 0; } .kb-banner.bottom { bottom: 0; }
.kb-banner p { margin: 0; } .kb-banner a { color: inherit; }
.kb-banner .kb-btn { background: rgba(255,255,255,.18); color: inherit; padding: 6px 12px; }
.kb-banner .kb-btn:hover { background: rgba(255,255,255,.28); }
.kb-banner .kb-x { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: inherit; opacity: .85; }
.kb-banner .kb-x:hover { background: rgba(255,255,255,.18); }

/* ---------- hotspot beacon ---------- */
.kb-beacon { position: fixed; z-index: 2147482998; width: 18px; height: 18px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 0 3px var(--bg); cursor: pointer; }
.kb-beacon::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--accent); animation: kb-pulse 1.8s ease-out infinite; }
@keyframes kb-pulse { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(2.6); opacity: 0; } }

/* ---------- nudge ---------- */
.kb-nudge { position: fixed; bottom: 80px; z-index: 2147483000; width: 320px; max-width: calc(100vw - 32px); background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow); padding: 14px 14px 12px; animation: kb-pop .2s ease-out; }
.kb-nudge-msg { font-size: 13.5px; margin: 0 26px 10px 0; }
.kb-nudge-article { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 9px; background: var(--bg-soft); border: 1px solid var(--border); }
.kb-nudge-article:hover { border-color: var(--accent); }
.kb-nudge-article strong { display: block; font-size: 13.5px; }
.kb-nudge-article span { font-size: 12.5px; color: var(--fg-muted); }

/* ---------- picker ---------- */
.kb-pick-box { position: fixed; z-index: 2147483003; pointer-events: none; border: 2px solid #f59e0b; background: rgba(245, 158, 11, .12); border-radius: 4px; transition: all .05s; }
.kb-pick-bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483004; background: #111827; color: #fff; padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: var(--shadow); display: flex; gap: 10px; align-items: center; max-width: calc(100vw - 24px); }
.kb-pick-bar code { background: rgba(255,255,255,.12); padding: 2px 6px; border-radius: 5px; font-size: 12px; word-break: break-all; }
.kb-pick-bar button { color: #fbbf24; font-weight: 600; }

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
