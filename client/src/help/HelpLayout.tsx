import { useEffect, useState, type FormEvent } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { cx } from "../ui";

export function SearchBar({ big = false, autoFocus = false }: { big?: boolean; autoFocus?: boolean }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const navigate = useNavigate();
  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/help/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form onSubmit={submit} role="search" className="w-full">
      <label className={cx("flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white shadow-sm transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-zinc-800 dark:bg-zinc-900", big ? "h-14 px-5" : "h-11 px-4")}>
        <svg viewBox="0 0 24 24" width={big ? 20 : 16} height={big ? 20 : 16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-zinc-400">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder="Search or ask a question…" aria-label="Search help articles" className={cx("w-full bg-transparent placeholder:text-zinc-400 focus:outline-none", big ? "text-base" : "text-sm")} />
        {big && (
          <button className="hidden h-9 shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 sm:block">
            Search
          </button>
        )}
      </label>
    </form>
  );
}

export function HelpLayout() {
  const loc = useLocation();
  const home = loc.pathname === "/help" || loc.pathname === "/help/";
  const [siteName, setSiteName] = useState("Help Center");
  useEffect(() => {
    fetch("/api/public/config")
      .then((r) => r.json())
      .then((c) => {
        setSiteName(c.siteName);
        document.title = c.siteName;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <Link to="/help" className="flex shrink-0 items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" />
              </svg>
            </span>
            <span className="hidden sm:inline">{siteName}</span>
          </Link>
          {!home && (
            <div className="ml-auto w-full max-w-md">
              <SearchBar />
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-200 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800">
        {siteName} · Powered by Lumen
      </footer>
    </div>
  );
}
