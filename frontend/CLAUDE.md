# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is pnpm (`packageManager` in package.json; `pnpm-lock.yaml` is canonical — `package-lock.json` is untracked noise).

- `pnpm dev` — dev server on http://localhost:3000
- `pnpm build` / `pnpm start` — production build / serve
- `pnpm lint` — ESLint (flat config, `eslint.config.mjs`)

There is no test suite. `/env-check` is a dev-only page (404 in production) for verifying that environment variables are configured.

## Next.js version warning

This is Next.js 16 / React 19 with breaking changes versus older versions. `AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/` (`01-app`, `03-architecture`, …) before writing Next-specific code. Path alias: `@/app/...` (imports are rooted at the repo, e.g. `@/app/lib/plan/tiers`).

## What this is

"Sucvar" — an AI interior/exterior/garden design studio (a bachelor's thesis project), localized for the French market (Paris & Île-de-France). Users upload a room photo, pick a space mode, style, layout, and budget, and get an AI-redesigned image. Many code comments are in Romanian; API-route comments are in English.

**i18n (FR default · EN · RO)**: `app/lib/i18n/` — `tr(lang, ro, en, fr?)`, `makeT`, `trList`, `LOCALES`, `unitLabel`. Call sites keep writing `t('ro', 'en')`; French comes from `fr.ts` (dictionary keyed by the English source string) or from `patterns.ts` (API strings with numbers). Pass the third `fr` argument for interpolated strings. If you change an English string, rename its key in `fr.ts`. `usePrefs()` returns `lang` (default `'fr'` when nothing is stored) and a bound `t`. Money/dates are formatted `fr-FR` (`1 450,00 €`).

**French retailers**: `app/lib/retailers.ts` (Leroy Merlin, Castorama, IKEA France, ManoMano, Brico Dépôt, La Plateforme du Bâtiment, Point.P; trade materials → Point.P / La Plateforme / Brico Dépôt, décor & fixtures → Leroy Merlin / Castorama / IKEA / ManoMano) is an exact mirror of `backend/src/Sucvar.Domain/Procurement/FrenchRetail.cs`; keep both in sync. The BOM keeps its historical Romanian `query`; links are built from its French translation. **B2B**: TVA 20 % default, 10 % (rénovation > 2 ans) one-click (`VAT_PRESETS` in `lib/b2b/estimate.ts`), Paris/IDF regions, SIREN/SIRET = `regNo`, N° TVA intracom = `vatId`.

## Architecture (decoupled)

The server side lives in `../backend` (ASP.NET Core Web API, .NET 10). This app is UI only: **no `app/api/`, no service-role key, no Stripe/Replicate SDKs**.

**App Router, all under `app/`.** Pages: `/` (landing), `/generate` (Studio), `/b2b` (agency), `/checkout`, `/checkout/success`, `/account`, `/login`, `/p/[id]` (public portal, Server Component), `/account` (profile: `components/account/*`, data from `GET/PUT /api/profile` via `lib/profile/client.ts`), `/profile` (308 → `/account`), `/termeni`, `/confidentialitate`, `/rambursare` (legal, text in `components/legal/content.ts`), `/env-check` (dev only). `error.tsx` / `global-error.tsx` use Next 16's `retry()`; `robots.ts`, `sitemap.ts`, OpenGraph in `layout.tsx` (base URL from `lib/site.ts`).

**API access**: always through `app/lib/api-client.ts` (`apiFetch`, `readJson`, `apiJson`, `ApiError`). Base URL = `NEXT_PUBLIC_API_URL` in the browser, `API_INTERNAL_URL` (fallback `NEXT_PUBLIC_API_URL`) on the server. `auth: true` / `token` attach `Authorization: Bearer <supabase access_token>`. Errors keep the monolith contract `{ error, code }`; ASP.NET ProblemDetails are normalized to it. Call sites: `generate/page.tsx`, `checkout/page.tsx`, `checkout/success/page.tsx`, `components/studio/ProcurementPanel.tsx`, `lib/portal/client.ts`, `lib/b2b/cloud.ts`, `lib/b2b/company.ts` (company profile, cloud = source of truth, localStorage = cache), `components/ui/SubscriptionCard.tsx` (Stripe Customer Portal), `p/[id]/page.tsx` (forwards the visitor IP; uses `unstable_rethrow` in its catch).

**Shared pure modules kept here** (the backend has C# ports verified by golden tests): `data/catalog.ts` + `spaces.ts` + `styleSpecs.ts`, `lib/procurement.ts` (offline BOM fallback), `lib/studio/validation.ts`, `lib/studio/aiConfig.ts` (AI_LIMITS / PLAN_LIMITS, moved from `lib/ai/config.ts`), `lib/plan/tiers.ts`. If you change catalog data, re-run `backend/tools/golden/gen.cjs` and copy `catalog.json` into `backend/src/Sucvar.Domain/Catalog/`.

**Plans**: `'starter' | 'pro' | 'agency'` (`lib/plan/tiers.ts`). Client side is UX only (`lib/plan/client.ts`, `usePlan`, `useEnterpriseAccess`, `UpgradeGate`, `EnterpriseGate`); enforcement is in the API.

**Admin** (`/admin`, `components/admin/*`, `lib/admin/{client,useAccountRole}.ts`): the role comes from `GET /api/profile` (`role`, `isBanned` = `profiles.role` / `is_banned`, migration 005), cached 60 s by `useAccountRole` and used for the Navbar ADMIN link, the `/admin` 403 view and the `/b2b` gate (agency OR admin, same rule as the API). Real authorization is the API's `AdminOnly` policy on `/api/admin/**`. `/login` hides sign-up when `GET /api/public/status` says `allowNewRegistrations: false`.

**Supabase** (`app/lib/supabase/`): browser client only — `client.ts`, `auth.ts` (login, Google OAuth, `getAccessToken`), `projects.ts` (RLS-protected CRUD with local fallback), `tier.ts`, `errors.ts`, `url.ts`.

**Browser state**: `sucvar_*` localStorage keys in `app/lib/storage.ts`; reactive reads via `app/lib/useStoredValue.ts`; language/theme from `usePrefs()`.

**Theming**: `app/lib/theme/{tokens,skin,usePrefs}`, `components/ui/Editorial.tsx`, `globals.css`.

## Environment (`.env.local`, see `.env.example`)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`), `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL` (server only, optional), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` (legal pages). No server secrets.
