import { useState } from "react";
import { del, get, post, put } from "../api";
import { Button, Card, Field, Input, Loading, PageHeader, Table, Td, toast, useAsync } from "../ui";
import { useMe } from "./AdminApp";

type Col = { id: number; slug: string; name: string; description: string; icon: string; position: number; article_count: number };
const empty = { name: "", description: "", icon: "book", position: 0 };

export function Collections() {
  const { data, loading, reload } = useAsync(() => get<Col[]>("/admin/collections"));
  const [editing, setEditing] = useState<(typeof empty & { id?: number }) | null>(null);
  const canEdit = useMe().admin!.role !== "viewer";

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await put(`/admin/collections/${editing.id}`, editing);
      else await post("/admin/collections", editing);
      setEditing(null);
      reload();
      toast("Saved");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async (c: Col) => {
    if (!confirm(`Delete "${c.name}"? Its articles stay, just without a collection.`)) return;
    await del(`/admin/collections/${c.id}`);
    reload();
  };

  return (
    <>
      <PageHeader title="Collections" description="Group articles into sections on the help center home page." actions={canEdit && <Button variant="primary" onClick={() => setEditing({ ...empty, position: data?.length ?? 0 })}>New collection</Button>} />
      {editing && (
        <Card title={editing.id ? "Edit collection" : "New collection"} className="mb-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr_100px]">
            <Field label="Name">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Description">
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label="Order">
              <Input type="number" value={editing.position} onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={save} disabled={!editing.name}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table head={["Name", "Description", "Articles", "Order", ""]} empty="No collections yet.">
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-zinc-600 dark:text-zinc-400">{c.description}</Td>
                <Td className="tabular-nums">{c.article_count}</Td>
                <Td className="tabular-nums">{c.position}</Td>
                <Td className="text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, name: c.name, description: c.description, icon: c.icon, position: c.position })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                        Delete
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
