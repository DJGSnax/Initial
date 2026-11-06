# Project rules

## No local data storage
Lumen must never store its data on the local disk of the machine it runs on.

- All app data (articles, prompts, settings, analytics, admin accounts, sessions) lives in the hosted Postgres given by `DATABASE_URL`.
- `DATABASE_URL=memory://` (in-memory Postgres, wiped on exit) is the only alternative, for demos and tests. It is refused in production.
- Do not add file-backed databases, local upload folders, on-disk caches or log files. Uploads, if added, go to hosted object storage. Logs go to stdout.
- In-process memory caches are fine.
- Scope: this covers server-side app data. Browser storage used by the embed snippet (`localStorage`/`sessionStorage` for frequency caps and tour progress) is separate and governed by the privacy settings.

## Other conventions
- No em dashes in UI copy, docs or comments.
- Prefer plain, non-corporate language in UI copy and docs.
