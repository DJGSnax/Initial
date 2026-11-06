import { useNavigate, Link } from "react-router-dom";
import { get } from "../api";
import { Badge, Button, Card, Loading, PageHeader, Table, Td, pct, statusTone, timeAgo, useAsync } from "../ui";
import { useMe } from "./AdminApp";
import type { PromptDefinition } from "@shared/types";

type Row = { id: number; name: string; type: string; status: string; priority: number; updatedAt: string; definition: PromptDefinition; shown: number; converted: number; dismissed: number };

export const TYPE_INFO: Record<string, { label: string; desc: string }> = {
  tour: { label: "Product tour", desc: "Several steps that walk through the UI, with a spotlight on each element." },
  tooltip: { label: "Tooltip", desc: "A tip pinned to one element." },
  hotspot: { label: "Hotspot", desc: "A pulsing dot on an element. The tip opens when clicked." },
  modal: { label: "Modal", desc: "A centered message for announcements or onboarding. Can have multiple slides." },
  banner: { label: "Banner", desc: "A bar across the top or bottom of the page." },
};

function triggerLabel(d: PromptDefinition) {
  const t = d.trigger;
  switch (t.type) {
    case "delay":
      return `after ${Math.round((t.delayMs ?? 0) / 1000)}s`;
    case "idle":
      return `idle ${Math.round((t.idleMs ?? 45000) / 1000)}s`;
    case "rage_click":
      return "on rage click";
    case "repeat_visit":
      return `visit #${t.visits ?? 3}`;
    case "custom_event":
      return `event "${t.eventName}"`;
    default:
      return t.type.replace("_", " ");
  }
}

export function PromptsList() {
  const { data, loading } = useAsync(() => get<Row[]>("/admin/prompts"));
  const navigate = useNavigate();
  const canEdit = useMe().admin!.role !== "viewer";
  return (
    <>
      <PageHeader
        title="In-app prompts"
        description="Tours, tooltips, hotspots, modals and banners shown by the embed snippet on your product pages."
        actions={canEdit && <Button variant="primary" onClick={() => navigate("/admin/prompts/new")}>New prompt</Button>}
      />
      <Card>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table head={["Name", "Type", "Where & when", "Status", "Shown (30d)", "Converted", "Dismissed"]} empty="No prompts yet.">
            {(data ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <Td>
                  <Link to={`/admin/prompts/${p.id}`} className="font-medium text-zinc-900 hover:text-brand-600 dark:text-white">
                    {p.name}
                  </Link>
                  <div className="text-xs text-zinc-500">updated {timeAgo(p.updatedAt)}</div>
                </Td>
                <Td>{TYPE_INFO[p.type]?.label ?? p.type}</Td>
                <Td className="text-xs text-zinc-600 dark:text-zinc-400">
                  {p.definition.targeting.urlRules.filter((r) => !r.exclude).map((r) => r.value).join(", ") || "all pages"} · {triggerLabel(p.definition)}
                </Td>
                <Td>
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                </Td>
                <Td className="tabular-nums">{p.shown}</Td>
                <Td className="tabular-nums">{pct(p.converted, p.shown)}</Td>
                <Td className="tabular-nums">{pct(p.dismissed, p.shown)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
