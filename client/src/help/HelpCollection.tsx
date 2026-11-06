import { Link, useParams } from "react-router-dom";
import { Loading, useAsync } from "../ui";
import type { PublicCollection } from "./HelpHome";

export function HelpCollection() {
  const { slug } = useParams();
  const { data, loading } = useAsync(() => fetch("/api/public/collections").then((r) => r.json() as Promise<PublicCollection[]>));
  const c = data?.find((x) => x.slug === slug);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-6 text-sm text-zinc-500">
        <Link to="/help" className="hover:text-zinc-900 dark:hover:text-white">
          All collections
        </Link>
      </nav>
      {loading ? (
        <Loading />
      ) : !c ? (
        <p>Collection not found.</p>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">{c.description}</p>
          <ul className="mt-8 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {c.articles.map((a) => (
              <li key={a.id}>
                <Link to={`/help/a/${a.slug}`} className="block px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <div className="font-medium">{a.title}</div>
                  {a.summary && <div className="mt-0.5 text-sm text-zinc-500">{a.summary}</div>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
