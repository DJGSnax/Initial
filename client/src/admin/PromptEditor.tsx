import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { del, get, post, put } from "../api";
import { Badge, Button, Card, Field, Input, Loading, Select, Textarea, Toggle, cx, statusTone, toast, useAsync } from "../ui";
import { useMe } from "./AdminApp";
import { TYPE_INFO } from "./PromptsList";
import type { PromptDefinition, PromptStep, PromptType, PromptStatus, TraitRule, UrlRule, Settings } from "@shared/types";

type Prompt = { id?: number; name: string; type: PromptType; status: PromptStatus; priority: number; definition: PromptDefinition; stepFunnel?: { step: number; n: number }[] };

const newStep = (n: number): PromptStep => ({ id: `s${Date.now().toString(36)}${n}`, title: "", body: "", placement: "auto", spotlight: true });

function defaults(type: PromptType): Prompt {
  return {
    name: "",
    type,
    status: "draft",
    priority: 0,
    definition: {
      steps: [newStep(0)],
      targeting: { urlRules: [], traitRules: [], audience: "all" },
      trigger: { type: type === "tour" || type === "modal" ? "delay" : "page_load", delayMs: 1500 },
      frequency: { mode: type === "banner" ? "once_per_session" : "until_dismissed" },
      theme: { dismissible: true, beacon: type === "hotspot", position: "top", size: "md" },
    },
  };
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card title={title} actions={hint && <span className="text-xs text-zinc-500">{hint}</span>}>
      {children}
    </Card>
  );
}

const PICK_URL_KEY = "lumen:preview-url";

export function PromptEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const canEdit = useMe().admin!.role !== "viewer";
  const [p, setP] = useState<Prompt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pageUrl, setPageUrl] = useState(() => localStorage.getItem(PICK_URL_KEY) ?? `${location.origin}/demo`);
  const [activeStep, setActiveStep] = useState(0);
  const [rendered, setRendered] = useState<PromptDefinition | null>(null);
  const pickingStep = useRef<number | null>(null);

  const { data: loaded, loading } = useAsync(() => (isNew ? Promise.resolve(null) : get<Prompt>(`/admin/prompts/${id}`)), [id]);
  const { data: articles } = useAsync(() => get<{ slug: string; title: string; status: string }[]>("/admin/articles?status=published"));
  const { data: settings } = useAsync(() => get<{ settings: Settings }>("/admin/settings"));

  useEffect(() => {
    if (loaded) setP(loaded);
  }, [loaded]);

  useEffect(() => {
    if (!p) return;
    const t = setTimeout(() => post<PromptDefinition>("/admin/prompts/render", p.definition).then(setRendered).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [p?.definition]);

  // Selector picked on the host page arrives via postMessage from the snippet.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "kb-pick" || pickingStep.current === null) return;
      try {
        if (new URL(pageUrl).origin !== e.origin) return;
      } catch {
        return;
      }
      const i = pickingStep.current;
      pickingStep.current = null;
      updateStep(i, { selector: String(e.data.selector) });
      toast("Element selected");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  });

  if (isNew && !p) {
    return (
      <div>
        <Link to="/admin/prompts" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Prompts
        </Link>
        <h1 className="mt-3 mb-6 text-2xl font-semibold tracking-tight">What kind of prompt?</h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(TYPE_INFO) as PromptType[]).map((t) => (
            <button key={t} onClick={() => setP(defaults(t))} className="rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-500 hover:shadow dark:border-zinc-800 dark:bg-zinc-900">
              <div className="font-semibold">{TYPE_INFO[t].label}</div>
              <div className="mt-1 text-sm text-zinc-500">{TYPE_INFO[t].desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if ((loading && !loaded) || !p) return <Loading />;

  const def = p.definition;
  const multiStep = p.type === "tour" || p.type === "modal";
  const needsSelector = p.type === "tooltip" || p.type === "hotspot";
  const allowedTraits = settings?.settings.privacy.allowedTraits ?? [];

  const update = (patch: Partial<Prompt>) => {
    setP({ ...p, ...patch });
    setDirty(true);
  };
  const updateDef = (patch: Partial<PromptDefinition>) => update({ definition: { ...def, ...patch } });
  function updateStep(i: number, patch: Partial<PromptStep>) {
    setP((cur) => {
      if (!cur) return cur;
      const steps = cur.definition.steps.map((s, j) => (j === i ? { ...s, ...patch } : s));
      return { ...cur, definition: { ...cur.definition, steps } };
    });
    setDirty(true);
  }
  const moveStep = (i: number, d: -1 | 1) => {
    const steps = [...def.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + d, 0, s);
    updateDef({ steps });
    setActiveStep(i + d);
  };

  const save = async (status?: PromptStatus) => {
    const body = { name: p.name, type: p.type, status: status ?? p.status, priority: p.priority, definition: def };
    try {
      if (isNew || !p.id) {
        const r = await post<{ id: number }>("/admin/prompts", body);
        setDirty(false);
        toast("Prompt created");
        navigate(`/admin/prompts/${r.id}`, { replace: true });
      } else {
        await put(`/admin/prompts/${p.id}`, body);
        setP({ ...p, status: body.status });
        setDirty(false);
        toast(status === "live" ? "Live. The snippet picks it up within 30 seconds." : status === "paused" ? "Paused" : "Saved");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const openOnPage = async (kind: "preview" | "pick", stepIndex?: number) => {
    localStorage.setItem(PICK_URL_KEY, pageUrl);
    try {
      if (kind === "preview") {
        if (!p.id || dirty) return toast("Save first, then preview", "err");
        const r = await post<{ url: string }>(`/admin/prompts/${p.id}/preview-link`, { url: pageUrl });
        window.open(r.url, "_blank");
      } else {
        pickingStep.current = stepIndex ?? 0;
        const r = await post<{ url: string }>("/admin/pick-link", { url: pageUrl });
        window.open(r.url, "_blank");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const step = def.steps[Math.min(activeStep, def.steps.length - 1)];
  const si = def.steps.indexOf(step);
  const renderedStep = rendered?.steps[si];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/prompts" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← Prompts
          </Link>
          <Badge tone="blue">{TYPE_INFO[p.type].label}</Badge>
          <Badge tone={statusTone(p.status)}>{p.status}</Badge>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {p.id && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm("Delete this prompt?")) return;
                  await del(`/admin/prompts/${p.id}`);
                  navigate("/admin/prompts");
                }}
              >
                Delete
              </Button>
            )}
            {p.status === "live" && <Button onClick={() => save("paused")}>Pause</Button>}
            <Button onClick={() => save()} disabled={!p.name}>
              Save
            </Button>
            {p.status !== "live" && (
              <Button variant="primary" onClick={() => save("live")} disabled={!p.name}>
                Go live
              </Button>
            )}
          </div>
        )}
      </div>

      <input
        value={p.name}
        onChange={(e) => update({ name: e.target.value })}
        placeholder="Internal name, e.g. “Billing page onboarding”"
        aria-label="Prompt name"
        className="w-full bg-transparent text-2xl font-semibold tracking-tight placeholder:text-zinc-300 focus:outline-none dark:placeholder:text-zinc-700"
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Test page URL" className="min-w-64 flex-1" hint="A page where the snippet is installed. Used for previewing and for picking elements.">
            <Input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://app.example.com/dashboard" />
          </Field>
          <Button onClick={() => openOnPage("preview")} disabled={!p.id}>
            Preview on page ↗
          </Button>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Section title={multiStep ? `Steps (${def.steps.length})` : "Content"}>
            {multiStep && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {def.steps.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveStep(i)}
                    className={cx("rounded-lg border px-3 py-1.5 text-sm", i === si ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800")}
                  >
                    {i + 1}. {s.title || "Untitled"}
                  </button>
                ))}
                {canEdit && (
                  <button
                    onClick={() => {
                      updateDef({ steps: [...def.steps, newStep(def.steps.length)] });
                      setActiveStep(def.steps.length);
                    }}
                    className="rounded-lg border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700"
                  >
                    + Add step
                  </button>
                )}
              </div>
            )}
            <div className="space-y-4">
              <Field label="Title">
                <Input value={step.title} onChange={(e) => updateStep(si, { title: e.target.value })} />
              </Field>
              <Field label="Message" hint="Markdown: **bold**, _italic_, [links](https://…), lists">
                <Textarea rows={4} value={step.body} onChange={(e) => updateStep(si, { body: e.target.value })} />
              </Field>
              {p.type !== "banner" && (
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Field label={needsSelector ? "Element (required)" : "Element (optional)"} hint={multiStep ? "Leave empty to show this step centered on screen." : "CSS selector. Stable attributes like data-kb-id work best."}>
                    <Input value={step.selector ?? ""} onChange={(e) => updateStep(si, { selector: e.target.value })} placeholder='[data-kb-id="export-csv"]' className="font-mono text-xs" />
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => openOnPage("pick", si)} disabled={!canEdit}>
                      Pick on page ↗
                    </Button>
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {p.type !== "banner" && p.type !== "modal" && (
                  <Field label="Placement">
                    <Select value={step.placement ?? "auto"} onChange={(e) => updateStep(si, { placement: e.target.value as PromptStep["placement"] })}>
                      {["auto", "top", "bottom", "left", "right"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Link to article">
                  <Select value={step.articleSlug ?? ""} onChange={(e) => updateStep(si, { articleSlug: e.target.value || undefined })}>
                    <option value="">None</option>
                    {articles?.map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Button label" hint={multiStep ? "Shown on the last step instead of “Done”" : undefined}>
                  <Input value={step.ctaLabel ?? ""} onChange={(e) => updateStep(si, { ctaLabel: e.target.value || undefined })} placeholder="e.g. Try it now" />
                </Field>
                <Field label="Button link">
                  <Input value={step.ctaUrl ?? ""} onChange={(e) => updateStep(si, { ctaUrl: e.target.value || undefined })} placeholder="/settings or https://…" />
                </Field>
              </div>
              {p.type === "tour" && step.selector && (
                <div className="flex flex-wrap gap-6">
                  <Toggle checked={step.spotlight !== false} onChange={(v) => updateStep(si, { spotlight: v })} label="Spotlight" hint="Dim the rest of the page" />
                  <Toggle checked={!!step.advanceOnClick} onChange={(v) => updateStep(si, { advanceOnClick: v })} label="Advance when clicked" hint="User clicks the element to continue" />
                </div>
              )}
              {multiStep && def.steps.length > 1 && canEdit && (
                <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <Button size="sm" variant="ghost" disabled={si === 0} onClick={() => moveStep(si, -1)}>
                    ← Move earlier
                  </Button>
                  <Button size="sm" variant="ghost" disabled={si === def.steps.length - 1} onClick={() => moveStep(si, 1)}>
                    Move later →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-rose-600"
                    onClick={() => {
                      updateDef({ steps: def.steps.filter((_, j) => j !== si) });
                      setActiveStep(Math.max(0, si - 1));
                    }}
                  >
                    Remove step
                  </Button>
                </div>
              )}
            </div>
          </Section>

          <Section title="Where" hint="Evaluated in the browser on every page view">
            <UrlRules rules={def.targeting.urlRules} onChange={(urlRules) => updateDef({ targeting: { ...def.targeting, urlRules } })} />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Audience">
                <Select value={def.targeting.audience} onChange={(e) => updateDef({ targeting: { ...def.targeting, audience: e.target.value as "all" } })}>
                  <option value="all">Everyone</option>
                  <option value="identified">Signed-in (identified)</option>
                  <option value="anonymous">Anonymous visitors</option>
                </Select>
              </Field>
            </div>
            <TraitRules rules={def.targeting.traitRules} allowed={allowedTraits} onChange={(traitRules) => updateDef({ targeting: { ...def.targeting, traitRules } })} />
          </Section>

          <Section title="When">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trigger">
                <Select value={def.trigger.type} onChange={(e) => updateDef({ trigger: { ...def.trigger, type: e.target.value as PromptDefinition["trigger"]["type"] } })}>
                  <option value="page_load">Page load</option>
                  <option value="delay">After a delay</option>
                  <option value="scroll">After scrolling</option>
                  <option value="element_click">When an element is clicked</option>
                  <option value="custom_event">Custom event (kb('track', name))</option>
                  <option value="idle">User seems stuck (idle)</option>
                  <option value="rage_click">Rage click (frustration)</option>
                  <option value="repeat_visit">Repeat visits to this page</option>
                  <option value="exit_intent">Exit intent (desktop)</option>
                </Select>
              </Field>
              {def.trigger.type === "delay" && (
                <Field label="Delay (seconds)">
                  <Input type="number" min={0} value={(def.trigger.delayMs ?? 0) / 1000} onChange={(e) => updateDef({ trigger: { ...def.trigger, delayMs: Number(e.target.value) * 1000 } })} />
                </Field>
              )}
              {def.trigger.type === "idle" && (
                <Field label="Idle for (seconds)" hint="No mouse, keyboard or scroll after the user started interacting">
                  <Input type="number" min={5} value={(def.trigger.idleMs ?? 45000) / 1000} onChange={(e) => updateDef({ trigger: { ...def.trigger, idleMs: Number(e.target.value) * 1000 } })} />
                </Field>
              )}
              {def.trigger.type === "scroll" && (
                <Field label="Scrolled past (%)">
                  <Input type="number" min={0} max={100} value={def.trigger.scrollPct ?? 50} onChange={(e) => updateDef({ trigger: { ...def.trigger, scrollPct: Number(e.target.value) } })} />
                </Field>
              )}
              {def.trigger.type === "element_click" && (
                <Field label="Element selector">
                  <Input className="font-mono text-xs" value={def.trigger.selector ?? ""} onChange={(e) => updateDef({ trigger: { ...def.trigger, selector: e.target.value } })} />
                </Field>
              )}
              {def.trigger.type === "custom_event" && (
                <Field label="Event name">
                  <Input value={def.trigger.eventName ?? ""} onChange={(e) => updateDef({ trigger: { ...def.trigger, eventName: e.target.value } })} placeholder="report_created" />
                </Field>
              )}
              {def.trigger.type === "repeat_visit" && (
                <Field label="Show on visit number" hint="Within one browser session">
                  <Input type="number" min={1} value={def.trigger.visits ?? 3} onChange={(e) => updateDef({ trigger: { ...def.trigger, visits: Number(e.target.value) } })} />
                </Field>
              )}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Field label="How often">
                <Select value={def.frequency.mode} onChange={(e) => updateDef({ frequency: { ...def.frequency, mode: e.target.value as "once" } })}>
                  <option value="once">Once ever</option>
                  <option value="until_dismissed">Until dismissed or completed</option>
                  <option value="once_per_session">Once per session</option>
                  <option value="every_n_days">Every N days</option>
                  <option value="every_time">Every time</option>
                </Select>
              </Field>
              {def.frequency.mode === "every_n_days" && (
                <Field label="Days">
                  <Input type="number" min={1} value={def.frequency.days ?? 7} onChange={(e) => updateDef({ frequency: { ...def.frequency, days: Number(e.target.value) } })} />
                </Field>
              )}
              <Field label="Max impressions" hint="Optional cap per browser">
                <Input type="number" min={1} value={def.frequency.maxImpressions ?? ""} onChange={(e) => updateDef({ frequency: { ...def.frequency, maxImpressions: e.target.value ? Number(e.target.value) : undefined } })} />
              </Field>
              <Field label="Priority" hint="Higher wins when two would show">
                <Input type="number" value={p.priority} onChange={(e) => update({ priority: Number(e.target.value) })} />
              </Field>
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          <div className="lg:sticky lg:top-6 space-y-5">
            <Card title="Preview">
              <PreviewCard type={p.type} step={step} html={renderedStep?.bodyHtml ?? ""} index={si} total={def.steps.length} accent={def.theme.accent ?? settings?.settings.launcher.accent ?? "#4f46e5"} />
            </Card>
            <Card title="Appearance">
              <div className="space-y-4">
                <Field label="Accent color">
                  <div className="flex gap-2">
                    <input type="color" value={def.theme.accent ?? settings?.settings.launcher.accent ?? "#4f46e5"} onChange={(e) => updateDef({ theme: { ...def.theme, accent: e.target.value } })} className="h-9 w-12 rounded border border-zinc-300 dark:border-zinc-700" aria-label="Accent color" />
                    {def.theme.accent && (
                      <Button size="sm" variant="ghost" onClick={() => updateDef({ theme: { ...def.theme, accent: undefined } })}>
                        Use default
                      </Button>
                    )}
                  </div>
                </Field>
                {p.type === "banner" && (
                  <Field label="Position">
                    <Select value={def.theme.position ?? "top"} onChange={(e) => updateDef({ theme: { ...def.theme, position: e.target.value as "top" } })}>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </Select>
                  </Field>
                )}
                {p.type === "modal" && (
                  <Field label="Size">
                    <Select value={def.theme.size ?? "md"} onChange={(e) => updateDef({ theme: { ...def.theme, size: e.target.value as "md" } })}>
                      <option value="sm">Small</option>
                      <option value="md">Medium</option>
                      <option value="lg">Large</option>
                    </Select>
                  </Field>
                )}
                <Toggle checked={def.theme.dismissible !== false} onChange={(v) => updateDef({ theme: { ...def.theme, dismissible: v } })} label="Can be dismissed" />
              </div>
            </Card>
            {!!p.stepFunnel?.length && p.type === "tour" && (
              <Card title="Tour funnel (30 days)">
                <ul className="space-y-2">
                  {def.steps.map((s, i) => {
                    const n = p.stepFunnel!.find((f) => f.step === i)?.n ?? 0;
                    const max = p.stepFunnel![0]?.n || 1;
                    return (
                      <li key={s.id} className="text-sm">
                        <div className="flex justify-between">
                          <span className="truncate">
                            {i + 1}. {s.title || "Untitled"}
                          </span>
                          <span className="tabular-nums text-zinc-500">{n}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UrlRules({ rules, onChange }: { rules: UrlRule[]; onChange: (r: UrlRule[]) => void }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Pages</div>
      {!rules.length && <p className="mb-2 text-sm text-zinc-500">Shows on every page. Add a rule to narrow it down.</p>}
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Select value={r.exclude ? "exclude" : "include"} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, exclude: e.target.value === "exclude" } : x)))} className="w-28" aria-label="Include or exclude">
              <option value="include">Show on</option>
              <option value="exclude">Hide on</option>
            </Select>
            <Select value={r.op} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, op: e.target.value as UrlRule["op"] } : x)))} className="w-36" aria-label="Match type">
              <option value="equals">path is</option>
              <option value="starts_with">path starts with</option>
              <option value="contains">path contains</option>
              <option value="glob">path matches (glob)</option>
              <option value="regex">path matches regex</option>
            </Select>
            <Input value={r.value} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="/settings/billing" className="min-w-40 flex-1 font-mono text-xs" aria-label="Path" />
            <Button variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule">
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => onChange([...rules, { op: "starts_with", value: "/" }])}>
        + Add page rule
      </Button>
    </div>
  );
}

function TraitRules({ rules, allowed, onChange }: { rules: TraitRule[]; allowed: string[]; onChange: (r: TraitRule[]) => void }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">User traits</div>
      <p className="mb-2 text-xs text-zinc-500">Only traits on the privacy allowlist can be used ({allowed.join(", ") || "none"}). Change it under Settings → Privacy.</p>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Select value={r.key} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="w-40" aria-label="Trait">
              {[...new Set([r.key, ...allowed])].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
            <Select value={r.op} onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, op: e.target.value as TraitRule["op"] } : x)))} className="w-32" aria-label="Operator">
              <option value="eq">is</option>
              <option value="neq">is not</option>
              <option value="in">is one of</option>
              <option value="not_in">is not one of</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
              <option value="exists">is set</option>
              <option value="not_exists">is not set</option>
            </Select>
            {!["exists", "not_exists"].includes(r.op) && (
              <Input
                value={Array.isArray(r.value) ? r.value.join(", ") : String(r.value ?? "")}
                onChange={(e) => {
                  const raw = e.target.value;
                  const value = r.op === "in" || r.op === "not_in" ? raw.split(",").map((s) => s.trim()) : r.op === "gt" || r.op === "lt" ? Number(raw) : raw;
                  onChange(rules.map((x, j) => (j === i ? { ...x, value } : x)));
                }}
                className="min-w-32 flex-1"
                placeholder={r.op === "in" || r.op === "not_in" ? "trial, starter" : "value"}
                aria-label="Value"
              />
            )}
            <Button variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove trait rule">
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" disabled={!allowed.length} onClick={() => onChange([...rules, { key: allowed[0], op: "eq", value: "" }])}>
        + Add trait rule
      </Button>
    </div>
  );
}

function PreviewCard({ type, step, html, index, total, accent }: { type: PromptType; step: PromptStep; html: string; index: number; total: number; accent: string }) {
  if (type === "banner") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg px-4 py-3 text-center text-sm text-white" style={{ background: accent }}>
        {step.title && <strong>{step.title}</strong>}
        <span dangerouslySetInnerHTML={{ __html: html }} className="[&_p]:m-0" />
        {step.ctaLabel && <span className="rounded-md bg-white/20 px-2.5 py-1 font-semibold">{step.ctaLabel}</span>}
      </div>
    );
  }
  const last = index === total - 1;
  return (
    <div className="rounded-xl bg-zinc-100 p-4 dark:bg-zinc-950">
      {step.selector && (type === "tooltip" || type === "hotspot" || type === "tour") && (
        <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
          <span className="relative inline-flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: accent }} />
            <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: accent }} />
          </span>
          anchored to <code className="truncate font-mono">{step.selector}</code>
        </div>
      )}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-1 text-[15px] font-bold">{step.title || <span className="text-zinc-400">Title</span>}</div>
        <div className="text-[13.5px] text-zinc-600 dark:text-zinc-400 [&_p]:my-1" dangerouslySetInnerHTML={{ __html: html || '<p class="text-zinc-400">Message</p>' }} />
        {step.articleSlug && (
          <div className="mt-2 text-[13px] font-semibold" style={{ color: accent }}>
            Read the guide →
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          {total > 1 ? (
            <div className="flex gap-1">
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className="h-1.5 rounded-full" style={{ width: i === index ? 16 : 6, background: i === index ? accent : "#d4d4d8" }} />
              ))}
            </div>
          ) : (
            <span />
          )}
          <span className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: accent }}>
            {last && step.ctaLabel ? step.ctaLabel : type === "tooltip" || type === "hotspot" ? step.ctaLabel || "Got it" : last ? "Done" : "Next"}
          </span>
        </div>
      </div>
    </div>
  );
}
