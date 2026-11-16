# SUCVAR — frontend

Next.js 16 · React 19 · Tailwind 4. UI only: all business rules, billing and AI calls live in the .NET API
(`../backend`). Default language Romanian, with English and French.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm lint
pnpm build && pnpm start
```

Configure `.env.local` from `.env.example` and check it at `/env-check` (development only).

## Layout

- `app/` — routes (`/`, `/generate`, `/b2b`, `/account`, `/login`, `/admin`, `/checkout`, `/p/[id]`, legal pages)
- `app/components/<feature>/` — `studio`, `b2b`, `home`, `portal`, `account`, `admin`, `login`, `layout`, `ui`
- `app/lib/` — `api-client.ts` (single HTTP gateway to the API), `i18n`, `plan`, `studio`, `b2b`, `portal`, `profile`, `admin`, `supabase`, `theme`
- `app/data/` — catalog, spaces, style specs, landing copy
- `app/types/` — shared domain types (barrel: `@/app/types`)

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the full system design and `CLAUDE.md` for conventions.
