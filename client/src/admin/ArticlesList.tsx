import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get } from "../api";
import { Badge, Button, Card, Input, Loading, PageHeader, Select, Table, Td, statusTone, timeAgo, useAsync } from "../ui";
import { useMe } from "./AdminApp";

type Row = { id: number; slug: string; title: string; status: string; collectionId: number | null; updatedAt: string; views: number };
type Col = { id: number; name: string };

export function ArticlesList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, loading } = useAsync(() => get<Row[]>(`/admin/articles?q=${encodeURIComponent(q)}&status=${status}`), [q, status]);
  const { data: cols } = useAsync(() => get<Col[]>("/admin/collections"));
  const navigate = useNavigate();
  const canEdit = useMe().admin!.role !== "viewer";
  const colName = (id: number | null) => cols?.find((c) => c.id === id)?.name ?? "–";

  return (
    <>
      <PageHeader
        title="Articles"
        description="Write once. Articles power the help center, the in-app widget and AI answers."
        actions={canEdit && <Button variant="primary" onClick={() => navigate("/admin/articles/new")}>New article</Button>}
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Filter by title or slug" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status">
            <option value="">All active</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table head={["Title", "Collection", "Status", "Views (30d)", "Updated"]} empty="No articles match.">
            {(data ?? []).map((a) => (
              <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <Td>
                  <Link to={`/admin/articles/${a.id}`} className="font-medium text-zinc-900 hover:text-brand-600 dark:text-white">
                    {a.title}
                  </Link>
                  <div className="text-xs text-zinc-500">/{a.slug}</div>
                </Td>
                <Td className="text-zinc-600 dark:text-zinc-400">{colName(a.collectionId)}</Td>
                <Td>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </Td>
                <Td className="tabular-nums">{a.views}</Td>
                <Td className="text-zinc-500">{timeAgo(a.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
