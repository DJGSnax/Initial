import { createContext, useContext, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { get, post } from "../api";
import { Button, Field, Input, Loading, cx, useAsync } from "../ui";
import { Dashboard } from "./Dashboard";
import { ArticlesList } from "./ArticlesList";
import { ArticleEditor } from "./ArticleEditor";
import { Collections } from "./Collections";
import { PromptsList } from "./PromptsList";
import { PromptEditor } from "./PromptEditor";
import { Insights } from "./Insights";
import { SettingsPage } from "./Settings";

type Me = { admin: { id: number; email: string; name: string; role: "owner" | "editor" | "viewer" } | null; needsSetup: boolean; aiAvailable: boolean };

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const nav = [
  { to: "/admin", label: "Overview", end: true, icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { to: "/admin/articles", label: "Articles", icon: "M6 3h9l5 5v13H6zM14 3v6h6M9 13h7M9 17h7" },
  { to: "/admin/collections", label: "Collections", icon: "M3 7h7l2 2h9v11H3z" },
  { to: "/admin/prompts", label: "In-app prompts", icon: "M4 5h16v11H8l-4 4z" },
  { to: "/admin/insights", label: "Behavior & AI", icon: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" },
  { to: "/admin/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
];

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6v12h9" />
        </svg>
      </div>
      <span className="font-semibold tracking-tight">Lumen</span>
    </div>
  );
}

function AuthScreen({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await post(setup ? "/admin/auth/setup" : "/admin/auth/login", form);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold">{setup ? "Create the owner account" : "Sign in"}</h1>
          {setup && <p className="mt-1 text-sm text-zinc-500">This is the first run. The account you create here can invite the rest of the team.</p>}
        </div>
        {setup && (
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" hint={setup ? "At least 10 characters" : undefined}>
          <Input type="password" required minLength={setup ? 10 : 1} autoComplete={setup ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <Button variant="primary" className="w-full" disabled={busy}>
          {setup ? "Create account" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const { data: me, loading, reload } = useAsync(() => get<Me>("/admin/auth/me"));
  const navigate = useNavigate();
  if (loading && !me) return <div className="p-10"><Loading /></div>;
  if (!me) return null;
  if (!me.admin) return <AuthScreen setup={me.needsSetup} onDone={reload} />;

  const logout = async () => {
    await post("/admin/auth/logout");
    reload();
    navigate("/admin");
  };

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="sticky top-0 z-20 flex shrink-0 flex-col border-b border-zinc-200 bg-white md:h-screen md:w-60 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-14 items-center justify-between px-4 md:h-16 md:px-5">
            <Logo />
            <a href="/help" target="_blank" className="text-xs text-zinc-500 hover:text-zinc-900 md:hidden dark:hover:text-white">
              Help center ↗
            </a>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-0">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                    isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white",
                  )
                }
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="hidden md:block">
                  <path d={n.icon} />
                </svg>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto hidden border-t border-zinc-200 p-4 md:block dark:border-zinc-800">
            <a href="/help" target="_blank" className="mb-3 block text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
              View help center ↗
            </a>
            <a href="/demo" target="_blank" className="mb-3 block text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
              Open demo app ↗
            </a>
            <div className="text-[13px] font-medium">{me.admin.name}</div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="capitalize">{me.admin.role}</span>
              <button onClick={logout} className="hover:text-zinc-900 dark:hover:text-white">
                Sign out
              </button>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mx-auto max-w-6xl">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="articles" element={<ArticlesList />} />
              <Route path="articles/:id" element={<ArticleEditor />} />
              <Route path="collections" element={<Collections />} />
              <Route path="prompts" element={<PromptsList />} />
              <Route path="prompts/:id" element={<PromptEditor />} />
              <Route path="insights" element={<Insights />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
