import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../api";
import { Badge, Button, Card, Loading, PageHeader, Table, Td, pct, toast, useAsync } from "../ui";
import { useMe } from "./AdminApp";
import type { PromptDefinition } from "@shared/types";

type Behavior = {
  strugglePages: { path: string; rage_clicks: number; idles: number; views: number; help_opens: number }[];
  rageTargets: { path: string; label: string; n: number }[];
  searchPages: { path: string; query: string; n: number }[];
  unhelpful: { query: string; n: number }[];
  zeroResults: { query: string; n: number }[];
  promptPerformance: { name: string; type: string; shown: number; dismissed: number; converted: number }[];
  nudges: { path: string; shown: number; clicked: number; dismissed: number }[];
};

type Insights = {
  summary: string;
  contentGaps: { title: string; why: string; outline: string[] }[];
  promptIdeas: { name: string; type: "tooltip" | "hotspot" | "modal" | "banner" | "tour"; path: string; trigger: string; title: string; body: string; articleSlug: string; why: string }[];
};

export function Insights() {
  const { data, loading } = useAsync(() => get<Behavior>("/admin/analytics/behavior?days=30"));
  const me = useMe();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const run = async () => {
    setBusy(true);
    try {
      setInsights(await post<Insights>("/admin/insights"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const createPrompt = async (idea: Insights["promptIdeas"][number]) => {
    const definition: PromptDefinition = {
      steps: [{ id: "s1", title: idea.title, body: idea.body, articleSlug: idea.articleSlug || undefined, placement: "auto" }],
      targeting: { urlRules: [{ op: idea.path.includes("*") ? "glob" : "starts_with", value: idea.path }], traitRules: [], audience: "all" },
      trigger: { type: idea.trigger as "page_load", delayMs: 2000, idleMs: 30000, visits: 3 },
      frequency: { mode: "until_dismissed" },
      theme: { dismissible: true },
    };
    const type = idea.type === "tooltip" || idea.type === "hotspot" ? "modal" : idea.type; // anchored types need an element picked first
    const r = await post<{ id: number }>("/admin/prompts", { name: idea.name, type, status: "draft", priority: 0, definition });
    toast("Draft prompt created");
    navigate(`/admin/prompts/${r.id}`);
  };

  const createArticle = async (gap: Insights["contentGaps"][number]) => {
    const bodyMd = gap.outline.map((h) => `## ${h}\n\n`).join("");
    const r = await post<{ id: number }>("/admin/articles", { title: gap.title, summary: "", bodyMd, status: "draft", tags: [], contextPaths: [] });
    toast("Draft article created");
    navigate(`/admin/articles/${r.id}`);
  };

  return (
    <>
      <PageHeader
        title="Behavior & AI"
        description="Where people get stuck, based on anonymous signals from the snippet: rage clicks, idling, repeated searches and form errors."
        actions={
          me.admin!.role !== "viewer" && (
            <Button variant="primary" onClick={run} disabled={busy || !me.aiAvailable} title={me.aiAvailable ? "" : "Set ANTHROPIC_API_KEY to enable"}>
              {busy ? "Analysing…" : "✦ Suggest fixes with AI"}
            </Button>
          )
        }
      />

      {insights && (
        <div className="mb-8 space-y-5">
          <Card title="AI read of the last 30 days">
            <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{insights.summary}</p>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Articles to write">
              <ul className="space-y-5">
                {insights.contentGaps.map((g) => (
                  <li key={g.title}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium">{g.title}</div>
                      <Button size="sm" onClick={() => createArticle(g)}>
                        Create draft
                      </Button>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{g.why}</p>
                    <ol className="mt-2 list-decimal pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                      {g.outline.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ol>
                  </li>
                ))}
                {!insights.contentGaps.length && <p className="text-sm text-zinc-500">No clear content gaps.</p>}
              </ul>
            </Card>
            <Card title="In-app prompts to try">
              <ul className="space-y-5">
                {insights.promptIdeas.map((idea) => (
                  <li key={idea.name}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{idea.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge tone="blue">{idea.type}</Badge>
                          <Badge>{idea.path}</Badge>
                          <Badge>{idea.trigger.replace("_", " ")}</Badge>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => createPrompt(idea)}>
                        Create draft
                      </Button>
                    </div>
                    <p className="mt-2 text-sm">
                      <strong>{idea.title}</strong> {idea.body}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">{idea.why}</p>
                  </li>
                ))}
                {!insights.promptIdeas.length && <p className="text-sm text-zinc-500">No prompt ideas this time.</p>}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <Card title="Pages where people struggle" actions={<span className="text-xs text-zinc-500">rage clicks weigh 3×</span>}>
            <Table head={["Page", "Views", "Rage clicks", "Idle", "Help opened"]} empty="No struggle signals yet. Once the snippet is live, this fills in.">
              {data.strugglePages.map((r) => (
                <tr key={r.path}>
                  <Td className="font-mono text-xs">{r.path}</Td>
                  <Td className="tabular-nums">{r.views}</Td>
                  <Td className="tabular-nums">{r.rage_clicks}</Td>
                  <Td className="tabular-nums">{r.idles}</Td>
                  <Td className="tabular-nums">{r.help_opens}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Most rage-clicked elements">
              <Table head={["Element", "Page", "Clicks"]} empty="None recorded">
                {data.rageTargets.map((r, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{r.label}</Td>
                    <Td className="font-mono text-xs">{r.path}</Td>
                    <Td className="tabular-nums">{r.n}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="What people search for, by page">
              <Table head={["Query", "Page", "Count"]} empty="No in-app searches yet">
                {data.searchPages.map((r, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{r.query}</Td>
                    <Td className="font-mono text-xs">{r.path}</Td>
                    <Td className="tabular-nums">{r.n}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="AI nudges">
              <Table head={["Page", "Shown", "Clicked", "Dismissed"]} empty="No nudges shown yet">
                {data.nudges.map((r) => (
                  <tr key={r.path}>
                    <Td className="font-mono text-xs">{r.path}</Td>
                    <Td className="tabular-nums">{r.shown}</Td>
                    <Td className="tabular-nums">{pct(r.clicked, r.shown)}</Td>
                    <Td className="tabular-nums">{pct(r.dismissed, r.shown)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="AI answers marked unhelpful">
              <Table head={["Query", "Count"]} empty="None">
                {data.unhelpful.map((r) => (
                  <tr key={r.query}>
                    <Td className="font-medium">{r.query}</Td>
                    <Td className="tabular-nums">{r.n}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <Card title="Prompt performance">
            <Table head={["Prompt", "Type", "Shown", "Converted", "Dismissed"]} empty="No prompt impressions yet">
              {data.promptPerformance.map((r) => (
                <tr key={r.name}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.type}</Td>
                  <Td className="tabular-nums">{r.shown}</Td>
                  <Td className="tabular-nums">{pct(r.converted, r.shown)}</Td>
                  <Td className="tabular-nums">{pct(r.dismissed, r.shown)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
