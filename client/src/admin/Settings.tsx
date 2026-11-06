import { useEffect, useState } from "react";
import { del, get, post, put } from "../api";
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea, Toggle, cx, toast, useAsync } from "../ui";
import { useMe } from "./AdminApp";
import type { Settings } from "@shared/types";

type Resp = { settings: Settings; publicUrl: string; aiAvailable: boolean; model: string };
const TABS = ["Install", "Launcher", "Privacy", "AI", "Team", "Data requests"] as const;

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-[12.5px] leading-5 text-zinc-100">{children}</pre>
      <button onClick={() => (navigator.clipboard.writeText(children), toast("Copied"))} className="absolute top-2 right-2 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20">
        Copy
      </button>
    </div>
  );
}

export function SettingsPage() {
  const { data, loading, setData } = useAsync(() => get<Resp>("/admin/settings"));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Install");
  const [s, setS] = useState<Settings | null>(null);
  const me = useMe();
  const isOwner = me.admin!.role === "owner";
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (loading || !data || !s) return <Loading />;

  const save = async (patch: Partial<Settings>) => {
    try {
      const next = await put<Settings>("/admin/settings", patch);
      setS(next);
      setData({ ...data, settings: next });
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === t ? "border-brand-600 text-brand-700 dark:text-brand-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white")}>
            {t}
          </button>
        ))}
      </div>
      {!isOwner && tab !== "Install" && tab !== "Team" && <p className="mb-4 text-sm text-amber-600">Only owners can change these settings.</p>}
      {tab === "Install" && <Install s={s} publicUrl={data.publicUrl} onSave={save} isOwner={isOwner} />}
      {tab === "Launcher" && <Launcher s={s} onSave={save} />}
      {tab === "Privacy" && <Privacy s={s} onSave={save} />}
      {tab === "AI" && <Ai s={s} onSave={save} available={data.aiAvailable} model={data.model} />}
      {tab === "Team" && <Team />}
      {tab === "Data requests" && <DataRequests />}
    </>
  );
}

function Install({ s, publicUrl, onSave, isOwner }: { s: Settings; publicUrl: string; onSave: (p: Partial<Settings>) => void; isOwner: boolean }) {
  const [origins, setOrigins] = useState(s.allowedOrigins.join("\n"));
  const [siteName, setSiteName] = useState(s.siteName);
  const snippet = `<script>
  window.kb = window.kb || function () { (kb.q = kb.q || []).push(arguments) };

  // 1. Consent: pass your consent tool's decision on every page load.
  kb('consent', { analytics: userAcceptedAnalytics });

  // 2. Identity (optional): a pseudonymous id computed on YOUR server.
  //    Never pass an email, name or raw database id.
  kb('identify', {
    id: '<%= kbVisitorId %>',
    traits: { plan: 'pro', role: 'admin' } // only allowlisted traits are kept
  });
</script>
<script async src="${publicUrl}/embed/kb.js"></script>`;

  const server = `// Node: compute the pseudonymous id server-side
import crypto from "node:crypto";

const kbVisitorId = crypto
  .createHmac("sha256", process.env.KB_IDENTITY_SECRET) // keep this secret in your app, not in Lumen
  .update(String(user.id))
  .digest("hex")
  .slice(0, 32);`;

  const api = `kb('open')                          // open the help panel
kb('open', { article: 'invite-teammates' })
kb('search', 'export csv')          // open with a search
kb('track', 'report_created')       // custom event (can trigger prompts)
kb('show', 12)                      // force-show prompt #12
kb('reset')                         // on logout: forget identity + local storage`;

  return (
    <div className="space-y-6">
      <Card title="1. Add the snippet to your app">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Paste before the closing &lt;/body&gt; tag on every page of your product. It loads asynchronously, renders inside a Shadow DOM so your CSS can't break it, and follows single-page-app route changes automatically.</p>
        <Code>{snippet}</Code>
      </Card>
      <Card title="2. Generate the visitor id on your server">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Lumen never sees your real user ids. Your backend hashes them with a secret only it knows, and Lumen hashes again with its own pepper before storing. Analytics can then be linked across sessions without anyone being able to reverse the id, and you can still find and delete a user's data on request (Settings → Data requests).
        </p>
        <Code>{server}</Code>
      </Card>
      <Card title="JavaScript API">
        <Code>{api}</Code>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Mark sensitive areas with <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">data-kb-private</code> and the snippet won't read labels or headings inside them. Add <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">data-kb-id="…"</code> to elements you want to target reliably.
        </p>
      </Card>
      <Card title="Site">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Help center name">
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} disabled={!isOwner} />
          </Field>
          <Field label="Allowed origins" hint="One per line, e.g. https://app.example.com. Only these sites can send events. Empty allows all in development only.">
            <Textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} disabled={!isOwner} className="font-mono text-xs" />
          </Field>
        </div>
        {isOwner && (
          <Button variant="primary" className="mt-4" onClick={() => onSave({ siteName, allowedOrigins: origins.split("\n").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean) })}>
            Save
          </Button>
        )}
      </Card>
    </div>
  );
}

function Launcher({ s, onSave }: { s: Settings; onSave: (p: Partial<Settings>) => void }) {
  const [l, setL] = useState(s.launcher);
  const [paths, setPaths] = useState(l.urlRules.map((r) => `${r.exclude ? "!" : ""}${r.value}`).join("\n"));
  return (
    <Card title="Help launcher">
      <div className="space-y-5">
        <Toggle checked={l.enabled} onChange={(v) => setL({ ...l, enabled: v })} label="Show the help launcher" hint="The floating button that opens search, AI answers and articles inside your app." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Button label">
            <Input value={l.label} onChange={(e) => setL({ ...l, label: e.target.value })} />
          </Field>
          <Field label="Panel greeting">
            <Input value={l.greeting} onChange={(e) => setL({ ...l, greeting: e.target.value })} />
          </Field>
          <Field label="Position">
            <Select value={l.position} onChange={(e) => setL({ ...l, position: e.target.value as "bottom-right" })}>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </Select>
          </Field>
          <Field label="Accent color">
            <div className="flex items-center gap-2">
              <input type="color" value={l.accent} onChange={(e) => setL({ ...l, accent: e.target.value })} className="h-9 w-12 rounded border border-zinc-300 dark:border-zinc-700" aria-label="Accent color" />
              <Input value={l.accent} onChange={(e) => setL({ ...l, accent: e.target.value })} className="w-28 font-mono text-xs" />
            </div>
          </Field>
        </div>
        <Field label="Only on these paths" hint="One path prefix per line. Prefix with ! to hide on a path. Empty shows everywhere.">
          <Textarea rows={3} value={paths} onChange={(e) => setPaths(e.target.value)} className="font-mono text-xs" placeholder={"/app\n!/app/checkout"} />
        </Field>
        <Button
          variant="primary"
          onClick={() =>
            onSave({
              launcher: {
                ...l,
                urlRules: paths
                  .split("\n")
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p) => ({ op: "starts_with" as const, value: p.replace(/^!/, ""), exclude: p.startsWith("!") })),
              },
            })
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function Privacy({ s, onSave }: { s: Settings; onSave: (p: Partial<Settings>) => void }) {
  const [p, setP] = useState(s.privacy);
  const [traits, setTraits] = useState(p.allowedTraits.join(", "));
  return (
    <div className="space-y-6">
      <Card title="Consent & identifiers">
        <div className="space-y-5">
          <Toggle checked={p.requireConsent} onChange={(v) => setP({ ...p, requireConsent: v })} label="Require analytics consent" hint="Recommended for GDPR/ePrivacy. Until kb('consent', { analytics: true }) is called, events are sent with no session or visitor id: they only count, they can't be linked to anyone." />
          <Toggle checked={p.respectGpc} onChange={(v) => setP({ ...p, respectGpc: v })} label="Honour Global Privacy Control and Do Not Track" hint="Treated as a refusal unless the user explicitly consents through your consent tool." />
          <Field label="Browser storage before consent" hint="Frequency caps (so a tip doesn't show again) and tour progress need storage to work across page loads.">
            <Select value={p.storage} onChange={(e) => setP({ ...p, storage: e.target.value as "functional_allowed" })}>
              <option value="functional_allowed">Allow functional storage (frequency caps, tour progress)</option>
              <option value="consent_required">Memory only until consent (prompts may repeat on reload)</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="What may be collected">
        <div className="space-y-5">
          <Field label="Allowed user traits" hint="Comma separated, lowercase. Anything else passed to kb('identify') is dropped in the browser and again on the server. Values that look like emails, phone numbers or long tokens are rejected.">
            <Input value={traits} onChange={(e) => setTraits(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field label="Page context for AI nudges" hint="What the snippet may send when asking for a suggestion. Text is scrubbed of emails and numbers either way, and nothing inside data-kb-private is read.">
            <Select value={p.nudgeContext} onChange={(e) => setP({ ...p, nudgeContext: e.target.value as "path_only" })}>
              <option value="path_and_headings">URL path, page title and main headings</option>
              <option value="path_only">URL path only</option>
            </Select>
          </Field>
          <Field label="Delete analytics after (days)">
            <Input type="number" min={1} max={3650} value={p.retentionDays} onChange={(e) => setP({ ...p, retentionDays: Number(e.target.value) })} className="w-32" />
          </Field>
        </div>
      </Card>
      <Card title="Never collected">
        <ul className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2 dark:text-zinc-400">
          {["IP addresses (rate limiting uses them in memory only)", "User agent strings (only mobile / tablet / desktop)", "Query strings and URL fragments", "Ids in paths (numbers, UUIDs, emails become :id)", "Form values or keystrokes", "Raw user ids, names or emails"].map((x) => (
            <li key={x} className="flex gap-2">
              <span className="text-emerald-600">✓</span>
              {x}
            </li>
          ))}
        </ul>
      </Card>
      <Button
        variant="primary"
        onClick={() =>
          onSave({
            privacy: {
              ...p,
              allowedTraits: traits
                .split(",")
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean),
            },
          })
        }
      >
        Save privacy settings
      </Button>
    </div>
  );
}

function Ai({ s, onSave, available, model }: { s: Settings; onSave: (p: Partial<Settings>) => void; available: boolean; model: string }) {
  const [a, setA] = useState(s.ai);
  return (
    <Card title="AI features" actions={available ? <Badge tone="green">{model}</Badge> : <Badge tone="amber">ANTHROPIC_API_KEY not set</Badge>}>
      <div className="space-y-5">
        {!available && <p className="text-sm text-amber-700 dark:text-amber-400">Set ANTHROPIC_API_KEY on the server to turn these on. Search keeps working without it.</p>}
        <Toggle checked={a.overview} onChange={(v) => setA({ ...a, overview: v })} label="AI overview in search" hint="A short answer generated only from your published articles, shown inline above search results (help center and widget), with numbered citations. If the articles don't answer the question, nothing is shown." />
        <Toggle checked={a.nudges} onChange={(v) => setA({ ...a, nudges: v })} label="Behavior nudges" hint="When someone seems stuck (rage clicks, form errors, repeated searches, idling, going back and forth), suggest the most relevant article in a small dismissible card. Without an API key, falls back to articles pinned to that page." />
        <Field label="Minimum minutes between nudges (per session)">
          <Input type="number" min={1} value={a.nudgeCooldownMin} onChange={(e) => setA({ ...a, nudgeCooldownMin: Number(e.target.value) })} className="w-32" />
        </Field>
        <Button variant="primary" onClick={() => onSave({ ai: a })}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function Team() {
  const { data, reload } = useAsync(() => get<{ id: number; email: string; name: string; role: string }[]>("/admin/team"));
  const me = useMe();
  const isOwner = me.admin!.role === "owner";
  const [f, setF] = useState({ name: "", email: "", role: "editor", password: "" });
  const [pw, setPw] = useState("");
  const add = async () => {
    try {
      await post("/admin/team", f);
      setF({ name: "", email: "", role: "editor", password: "" });
      reload();
      toast("Added. Share the temporary password with them privately.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="space-y-6">
      <Card title="Team">
        <Table head={["Name", "Email", "Role", ""]}>
          {(data ?? []).map((m) => (
            <tr key={m.id}>
              <Td className="font-medium">{m.name}</Td>
              <Td>{m.email}</Td>
              <Td className="capitalize">{m.role}</Td>
              <Td className="text-right">
                {isOwner && m.id !== me.admin!.id && (
                  <Button size="sm" variant="ghost" onClick={async () => confirm(`Remove ${m.name}?`) && (await del(`/admin/team/${m.id}`), reload())}>
                    Remove
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {isOwner && (
          <div className="mt-5 grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-[1fr_1fr_120px_1fr_auto] dark:border-zinc-800">
            <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </Select>
            <Input placeholder="Temporary password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <Button variant="primary" onClick={add}>
              Add
            </Button>
          </div>
        )}
      </Card>
      <Card title="Your password">
        <div className="flex flex-wrap gap-2">
          <Input type="password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} className="max-w-xs" autoComplete="new-password" />
          <Button
            onClick={async () => {
              try {
                await put("/admin/me/password", { password: pw });
                setPw("");
                toast("Password changed");
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
          >
            Change password
          </Button>
        </div>
      </Card>
    </div>
  );
}

function DataRequests() {
  const [vid, setVid] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const isOwner = useMe().admin!.role === "owner";
  const lookup = async () => {
    try {
      const r = await get<{ storedId: string; events: unknown[]; searches: unknown[] }>(`/admin/privacy/visitors/${encodeURIComponent(vid)}`);
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lumen-visitor-${r.storedId.slice(0, 8)}.json`;
      a.click();
      setResult(`Exported ${r.events.length} events and ${r.searches.length} searches.`);
    } catch (e) {
      setResult((e as Error).message);
    }
  };
  const erase = async () => {
    if (!confirm("Permanently delete all analytics for this visitor?")) return;
    try {
      const r = await del<{ eventsDeleted: number; searchesDeleted: number }>(`/admin/privacy/visitors/${encodeURIComponent(vid)}`);
      setResult(`Deleted ${r.eventsDeleted} events and ${r.searchesDeleted} searches.`);
    } catch (e) {
      setResult((e as Error).message);
    }
  };
  return (
    <div className="space-y-6">
      <Card title="Access and erasure requests">
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Enter the same pseudonymous id your app passes to <code>kb('identify')</code> for that user (compute it with your identity secret). Lumen re-hashes it and finds the matching records. Data collected before consent, or without identify, is anonymous and can't be linked to anyone.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={vid} onChange={(e) => setVid(e.target.value)} placeholder="visitor id from your app" className="max-w-sm font-mono text-xs" />
          <Button onClick={lookup} disabled={!vid || !isOwner}>
            Export data (JSON)
          </Button>
          <Button variant="danger" onClick={erase} disabled={!vid || !isOwner}>
            Delete data
          </Button>
        </div>
        {result && <p className="mt-3 text-sm">{result}</p>}
      </Card>
      <Card title="Automate it">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Set PRIVACY_API_TOKEN on the server and call these from your account-deletion flow:</p>
        <Code>{`curl -H "Authorization: Bearer $PRIVACY_API_TOKEN" ${location.origin}/api/privacy/visitors/<visitor-id>          # export
curl -X DELETE -H "Authorization: Bearer $PRIVACY_API_TOKEN" ${location.origin}/api/privacy/visitors/<visitor-id>  # erase`}</Code>
      </Card>
    </div>
  );
}
