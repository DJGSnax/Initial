import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { del, get, post, put } from "../api";
import { Badge, Button, Card, Field, Input, Loading, Select, Textarea, cx, statusTone, timeAgo, toast, useAsync } from "../ui";
import { useMe } from "./AdminApp";

type Article = {
  id?: number;
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  status: "draft" | "published" | "archived";
  collectionId: number | null;
  tags: string[];
  contextPaths: string[];
  updatedAt?: string;
  revisions?: { id: number; title: string; createdAt: string; author: string | null }[];
};
type Col = { id: number; name: string };

const blank: Article = { slug: "", title: "", summary: "", bodyMd: "", status: "draft", collectionId: null, tags: [], contextPaths: [] };

const TOOLBAR: { label: string; wrap?: [string, string]; line?: string; title: string }[] = [
  { label: "B", wrap: ["**", "**"], title: "Bold" },
  { label: "I", wrap: ["_", "_"], title: "Italic" },
  { label: "H2", line: "## ", title: "Heading" },
  { label: "H3", line: "### ", title: "Subheading" },
  { label: "•", line: "- ", title: "Bullet list" },
  { label: "1.", line: "1. ", title: "Numbered list" },
  { label: "</>", wrap: ["`", "`"], title: "Inline code" },
  { label: "Link", wrap: ["[", "](https://)"], title: "Link" },
  { label: "Tip", line: "> [!TIP]\n> ", title: "Tip callout" },
  { label: "Warn", line: "> [!WARNING]\n> ", title: "Warning callout" },
];

export function ArticleEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const canEdit = useMe().admin!.role !== "viewer";
  const { data: cols } = useAsync(() => get<Col[]>("/admin/collections"));
  const { data: loaded, loading } = useAsync(() => (isNew ? Promise.resolve(blank) : get<Article>(`/admin/articles/${id}`)), [id]);
  const [a, setA] = useState<Article>(blank);
  const [preview, setPreview] = useState("");
  const [view, setView] = useState<"split" | "write" | "preview">("split");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (loaded) {
      setA({ ...blank, ...loaded });
      setDirty(false);
    }
  }, [loaded]);

  // Server renders the preview so it matches production sanitization exactly.
  useEffect(() => {
    const t = setTimeout(() => post<{ html: string }>("/admin/render", { md: a.bodyMd }).then((r) => setPreview(r.html)), 250);
    return () => clearTimeout(t);
  }, [a.bodyMd]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch: Partial<Article>) => {
    setA((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  const save = async (status?: Article["status"]) => {
    setSaving(true);
    try {
      const body = { ...a, status: status ?? a.status, slug: a.slug || undefined };
      if (isNew) {
        const r = await post<{ id: number }>("/admin/articles", body);
        toast("Article created");
        setDirty(false);
        navigate(`/admin/articles/${r.id}`, { replace: true });
      } else {
        const r = await put<{ slug: string }>(`/admin/articles/${id}`, body);
        setA((x) => ({ ...x, status: body.status, slug: r.slug }));
        setDirty(false);
        toast(status === "published" ? "Published" : "Saved");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this article permanently? Consider archiving instead.")) return;
    await del(`/admin/articles/${id}`);
    toast("Deleted");
    navigate("/admin/articles");
  };

  const restore = async (revId: number) => {
    const r = await get<{ title: string; bodyMd: string }>(`/admin/articles/${id}/revisions/${revId}`);
    set({ title: r.title, bodyMd: r.bodyMd });
    toast("Revision loaded. Save to keep it.");
  };

  const applyTool = (t: (typeof TOOLBAR)[number]) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    let next: string;
    let cursor: number;
    if (t.wrap) {
      next = value.slice(0, s) + t.wrap[0] + value.slice(s, e) + t.wrap[1] + value.slice(e);
      cursor = e + t.wrap[0].length;
    } else {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      next = value.slice(0, lineStart) + t.line + value.slice(lineStart);
      cursor = s + t.line!.length;
    }
    set({ bodyMd: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  if (loading && !loaded) return <Loading />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/articles" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← Articles
          </Link>
          <Badge tone={statusTone(a.status)}>{a.status}</Badge>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {!isNew && a.status === "published" && (
              <a href={`/help/a/${a.slug}`} target="_blank" rel="noreferrer">
                <Button variant="ghost">View live ↗</Button>
              </a>
            )}
            {!isNew && (
              <Button variant="danger" onClick={remove}>
                Delete
              </Button>
            )}
            <Button onClick={() => save()} disabled={saving || !a.title}>
              Save {a.status === "published" ? "" : "draft"}
            </Button>
            {a.status !== "published" && (
              <Button variant="primary" onClick={() => save("published")} disabled={saving || !a.title}>
                Publish
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <input
            value={a.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Article title"
            aria-label="Title"
            className="w-full bg-transparent text-3xl font-bold tracking-tight placeholder:text-zinc-300 focus:outline-none dark:placeholder:text-zinc-700"
          />
          <Input value={a.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="One-line summary shown in search results and suggestions" aria-label="Summary" />

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
              <div className="flex flex-wrap gap-0.5">
                {TOOLBAR.map((t) => (
                  <button key={t.label} title={t.title} onClick={() => applyTool(t)} className="rounded px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
                {(["write", "split", "preview"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={cx("rounded-md px-2.5 py-1 capitalize", view === v && "bg-white shadow-sm dark:bg-zinc-700")}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className={cx("grid min-h-[520px]", view === "split" && "lg:grid-cols-2")}>
              {view !== "preview" && (
                <textarea
                  ref={ta}
                  value={a.bodyMd}
                  onChange={(e) => set({ bodyMd: e.target.value })}
                  placeholder={"Write in Markdown.\n\n## Headings become anchors\n> [!TIP]\n> Callouts work too."}
                  aria-label="Article body (Markdown)"
                  className="min-h-[520px] w-full resize-y border-0 bg-transparent p-4 font-mono text-[13px] leading-6 focus:outline-none"
                />
              )}
              {view !== "write" && <div className={cx("prose-kb overflow-y-auto p-5", view === "split" && "border-t border-zinc-200 lg:border-t-0 lg:border-l dark:border-zinc-800")} dangerouslySetInnerHTML={{ __html: preview || '<p class="text-zinc-400">Preview</p>' }} />}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <div className="space-y-4">
              <Field label="Collection">
                <Select value={a.collectionId ?? ""} onChange={(e) => set({ collectionId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">None</option>
                  {cols?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="URL slug" hint="Leave blank to generate from the title">
                <Input value={a.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder="auto" />
              </Field>
              <Field label="Tags" hint="Comma separated. Boosts search matches.">
                <Input value={a.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Show in app on these pages" hint={<>Paths where the widget suggests this article, and AI nudges prefer it. Use * as a wildcard, e.g. <code>/billing*</code></>}>
                <Textarea rows={3} value={a.contextPaths.join("\n")} onChange={(e) => set({ contextPaths: e.target.value.split("\n").map((t) => t.trim()).filter(Boolean) })} placeholder="/settings/team" />
              </Field>
              {a.status !== "archived" && !isNew && canEdit && (
                <Button size="sm" variant="ghost" onClick={() => save("archived")}>
                  Archive article
                </Button>
              )}
              {a.status === "archived" && canEdit && (
                <Button size="sm" onClick={() => save("draft")}>
                  Restore to draft
                </Button>
              )}
            </div>
          </Card>
          {!!a.revisions?.length && (
            <Card title="History">
              <ul className="space-y-2 text-sm">
                {a.revisions.slice(0, 12).map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-400">
                      {timeAgo(r.createdAt)} · {r.author ?? "unknown"}
                    </span>
                    {i > 0 && canEdit && (
                      <button className="shrink-0 text-xs font-medium text-brand-600 hover:underline" onClick={() => restore(r.id)}>
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
