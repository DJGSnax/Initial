import { Link } from "react-router-dom";
import { Loading, useAsync } from "../ui";
import { SearchBar } from "./HelpLayout";

export type PublicCollection = { id: number; slug: string; name: string; description: string; icon: string; articles: { id: number; slug: string; title: string; summary: string }[] };

export const collectionIcons: Record<string, string> = {
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12l3 3M12 15l6.5-6.5A5 5 0 0 0 20 4a5 5 0 0 0-4.5 1.5L9 12l-3-1 2-3h4",
  folder: "M3 7h7l2 2h9v11H3z",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  book: "M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13",
};

export function HelpHome() {
  const { data, loading } = useAsync(() => fetch("/api/public/collections").then((r) => r.json() as Promise<PublicCollection[]>));
  return (
    <>
      <section className="border-b border-zinc-200 bg-gradient-to-b from-brand-50/70 to-transparent px-4 py-16 sm:py-20 dark:border-zinc-800 dark:from-brand-700/10">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">How can we help?</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">Search our guides, or ask a question in your own words.</p>
          <div className="mt-8">
            <SearchBar big autoFocus />
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-12">
        {loading || !data ? (
          <Loading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data
              .filter((c) => c.articles.length)
              .map((c) => (
                <Link key={c.id} to={`/help/c/${c.slug}`} className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-700/20 dark:text-brand-100">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={collectionIcons[c.icon] ?? collectionIcons.book} />
                    </svg>
                  </div>
                  <h2 className="font-semibold group-hover:text-brand-600">{c.name}</h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{c.description}</p>
                  <p className="mt-3 text-xs text-zinc-500">
                    {c.articles.length} article{c.articles.length === 1 ? "" : "s"}
                  </p>
                </Link>
              ))}
          </div>
        )}
      </section>
    </>
  );
}
