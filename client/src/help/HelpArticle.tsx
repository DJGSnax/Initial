import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loading, timeAgo, useAsync } from "../ui";

type PublicArticle = { slug: string; title: string; summary: string; html: string; updatedAt: string; collection: { slug: string; name: string } | null; related: { slug: string; title: string }[] };

export function HelpArticle() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(
    () =>
      fetch(`/api/public/articles/${slug}`).then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json() as Promise<PublicArticle>;
      }),
    [slug],
  );
  const [voted, setVoted] = useState<boolean | null>(null);
  useEffect(() => {
    setVoted(null);
    if (data) document.title = data.title;
  }, [data]);

  const toc = useMemo(() => {
    if (!data) return [];
    const doc = new DOMParser().parseFromString(data.html, "text/html");
    return Array.from(doc.querySelectorAll("h2[id]")).map((h) => ({ id: h.id, text: h.textContent ?? "" }));
  }, [data]);

  // Keep internal links inside the SPA.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (href?.startsWith("/help/")) {
      e.preventDefault();
      navigate(href);
    }
  };

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-10"><Loading /></div>;
  if (error || !data) return <div className="mx-auto max-w-3xl px-4 py-16 text-center"><h1 className="text-xl font-semibold">Article not found</h1><Link to="/help" className="mt-3 inline-block text-brand-600">Back to the help center</Link></div>;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 lg:grid-cols-[1fr_220px]">
      <article className="min-w-0">
        <nav className="mb-6 flex flex-wrap gap-1.5 text-sm text-zinc-500">
          <Link to="/help" className="hover:text-zinc-900 dark:hover:text-white">
            Help center
          </Link>
          {data.collection && (
            <>
              <span>/</span>
              <Link to={`/help/c/${data.collection.slug}`} className="hover:text-zinc-900 dark:hover:text-white">
                {data.collection.name}
              </Link>
            </>
          )}
        </nav>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{data.title}</h1>
        {data.summary && <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">{data.summary}</p>}
        <p className="mt-3 text-xs text-zinc-500">Updated {timeAgo(data.updatedAt)}</p>
        <div className="prose-kb mt-8" onClick={onClick} dangerouslySetInnerHTML={{ __html: data.html }} />
        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          {voted === null ? (
            <>
              <span className="text-zinc-600 dark:text-zinc-400">Did this answer your question?</span>
              <button onClick={() => setVoted(true)} className="rounded-lg border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                Yes
              </button>
              <button onClick={() => setVoted(false)} className="rounded-lg border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                No
              </button>
            </>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400">{voted ? "Glad it helped." : "Thanks. Try searching with different words, or contact support."}</span>
          )}
        </div>
      </article>
      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-8 text-sm">
          {toc.length > 1 && (
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">On this page</div>
              <ul className="space-y-1.5">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="text-zinc-600 hover:text-brand-600 dark:text-zinc-400">
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!data.related.length && (
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Related</div>
              <ul className="space-y-1.5">
                {data.related.map((r) => (
                  <li key={r.slug}>
                    <Link to={`/help/a/${r.slug}`} className="text-zinc-600 hover:text-brand-600 dark:text-zinc-400">
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
