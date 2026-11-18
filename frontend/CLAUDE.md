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

"Sucvar" — an AI interior/exterior/garden design studio (a bachelor's thesis project), localized for the Romanian market. Users upload a room photo, pick a space mode, style, layout, and budget, and get an AI-redesigned image. Many code comments are in Romanian; API-route comments are in English.

**i18n (RO default · EN · FR)**: `app/lib/i18n/` — `tr(lang, ro, en, fr?)`, `makeT`, `trList`, `LOCALES`, `unitLabel`. Call sites keep writing `t('ro', 'en')`; French comes from `fr.ts` (dictionary keyed by the English source string) or from `patterns.ts` (API strings with numbers). Pass the third `fr` argument for interpolated strings. If you change an English string, rename its key in `fr.ts`. `usePrefs()` returns `lang` (default `'ro'` when nothing is stored) and a bound `t`. Dates/numbers are formatted `ro-RO`. **Money**: every amount is stored/computed in EUR; display it with `formatLei` / `toRon` from `lib/format.ts` (single fixed rate `EUR_TO_RON`), and convert lei inputs back with `fromRon`. Subscription prices stay in € (Stripe charges EUR).

**Romanian retailers**: `app/lib/retailers.ts` (Dedeman, Leroy Merlin, Hornbach, Brico Dépôt, IKEA România, Mobexpert; trade materials → Dedeman / Hornbach / Brico Dépôt, finishes → Dedeman / Leroy Merlin / Hornbach, furniture → IKEA / Mobexpert, lighting → IKEA / Dedeman) is an exact mirror of `backend/src/Sucvar.Domain/Procurement/RomanianRetail.cs`; keep both in sync. The BOM's Romanian `query` is used verbatim in the links. **B2B**: VAT 21 % default, 11 % one-click (`VAT_PRESETS` in `lib/b2b/estimate.ts`), default region `bucharest`, `regNo` = Nr. Reg. Com., `vatId` = CUI / RO VAT code (FR SIREN/intracom still accepted).

## Architecture (decoupled)

The server side lives in `../backend` (ASP.NET Core Web API, .NET 10). This app is UI only: **no `app/api/`, no service-role key, no Stripe/Replicate SDKs**.

**App Router, all under `app/`.** Pages: `/` (landing), `/generate` (Studio), `/b2b` (agency), `/checkout`, `/checkout/success`, `/account`, `/login`, `/p/[id]` (public portal, Server Component), `/account` (profile: `components/account/*`, data from `GET/PUT /api/profile` via `lib/profile/client.ts`), `/profile` (308 → `/account`), `/termeni`, `/confidentialitate`, `/rambursare` (legal, text in `components/legal/content.ts`), `/env-check` (dev only). `error.tsx` / `global-error.tsx` use Next 16's `retry()`; `robots.ts`, `sitemap.ts`, OpenGraph in `layout.tsx` (base URL from `lib/site.ts`).

**API access**: always through `app/lib/api-client.ts` (`apiFetch`, `readJson`, `apiJson`, `ApiError`). Base URL = `NEXT_PUBLIC_API_URL` in the browser, `API_INTERNAL_URL` (fallback `NEXT_PUBLIC_API_URL`) on the server. `auth: true` / `token` attach `Authorization: Bearer <supabase access_token>`. Errors keep the monolith contract `{ error, code }`; ASP.NET ProblemDetails are normalized to it. Call sites: `generate/page.tsx`, `checkout/page.tsx`, `checkout/success/page.tsx`, `components/studio/ProcurementPanel.tsx`, `lib/portal/client.ts`, `lib/b2b/cloud.ts`, `lib/b2b/company.ts` (company profile, cloud = source of truth, localStorage = cache), `components/ui/SubscriptionCard.tsx` (Stripe Customer Portal), `p/[id]/page.tsx` (forwards the visitor IP; uses `unstable_rethrow` in its catch).

**Shared pure modules kept here** (the backend has C# ports verified by golden tests): `data/catalog.ts` + `spaces.ts` + `styleSpecs.ts`, `lib/procurement.ts` (offline BOM fallback), `lib/studio/validation.ts`, `lib/studio/aiConfig.ts` (AI_LIMITS / PLAN_LIMITS, moved from `lib/ai/config.ts`), `lib/plan/tiers.ts`. If you change catalog data, re-run `backend/tools/golden/gen.cjs` and copy `catalog.json` into `backend/src/Sucvar.Domain/Catalog/`.

**Page decomposition**: large pages keep state and async flows; presentational sections are controlled components — Studio (3 zones: `StudioHeaderBar` = project name · step breadcrumbs · Save / Send to B2B; sticky control rail LEFT = `ModeSelector` (01, `workMode` redesign | optimize | area) → `RoomStylePicker` (02) → `RoomSizeCard` (03, collapsible, hosts `ErgonomicsPanel`) → `VisionPanel` (04, prompt + primary CTA as children; extras behind „Mai multe opțiuni”) → advanced settings (`StrengthSlider`, scenarios, `DimensionsPanel`, `ExpertAiSettings`); canvas + results RIGHT, `StudioViewport` owns photo upload/demo and one floating action toolbar + overflow menu): `components/studio/{ModeSelector,StudioHeaderBar,RoomStylePicker,RoomSizeCard,ErgonomicsPanel,VisionPanel,StudioCard,StudioViewport,StrengthSlider,ExpertAiSettings,PlanLimitNotice}` (dimensions live only in `RoomSizeCard`; `ExpertAiSettings` shows the compiled prompt via `POST /api/prompt-preview`), „Optimizare spațiu” / „Analiză ergonomică” `lib/studio/ergonomics.ts` (exact mirror of backend `Sucvar.Domain/Studio/SpatialErgonomicsAnalyzer.cs` — keep both in sync; sent as optional `optimizationGoal` + `ergonomicConstraints`, never with a mask), „Inspector obiecte” `components/studio/ObjectInspector` (hotspots from `detectedItems` of `/api/generate`, validated by `lib/studio/detectedItems.ts`, persisted in `dimensions.detectedItems` jsonb, rebuilt for old projects via `POST /api/detected-items`; backend `Sucvar.Domain/Studio/RoomObjectExtractor.cs`), chained edits („Editează acest rezultat” → step history `steps` in `generate/page.tsx`), render-in-progress overlay `components/studio/GenerationVeil` (CSS `gen-*` in `globals.css`), full-screen preview `components/ui/ImageLightbox` + pure helpers in `lib/studio/studioHelpers.ts` and `lib/studio/useLoadingTicker.ts`; landing: `components/home/{SupplierSection,StyleGallerySection,PricingSection,FaqSection}` (+ `sectionStyles.ts`); `/b2b`: `components/b2b/PricingConsole`; `/login`: `components/login/NewPasswordForm`. Shared ro-RO money/quantity formatting: `lib/format.ts` (`formatLei`, `toRon`, `fromRon`, `formatQuantity`). Never name a module `layout.ts`/`page.tsx` under `app/components/` — the App Router treats those filenames as routes.

**Plans**: `'starter' | 'pro' | 'agency'` (`lib/plan/tiers.ts`). Client side is UX only (`lib/plan/client.ts`, `usePlan`, `useEnterpriseAccess`, `UpgradeGate`, `EnterpriseGate`); enforcement is in the API.

**Admin** (`/admin`, `components/admin/*`, `lib/admin/{client,useAccountRole}.ts`): the role comes from `GET /api/profile` (`role`, `isBanned` = `profiles.role` / `is_banned`, migration 005), cached 60 s by `useAccountRole` and used for the Navbar ADMIN link, the `/admin` 403 view and the `/b2b` gate (agency OR admin, same rule as the API). Real authorization is the API's `AdminOnly` policy on `/api/admin/**`. `/login` hides sign-up when `GET /api/public/status` says `allowNewRegistrations: false`.

**Supabase** (`app/lib/supabase/`): browser client only — `client.ts`, `auth.ts` (login, Google OAuth, `getAccessToken`), `projects.ts` (RLS-protected CRUD with local fallback), `tier.ts`, `errors.ts`, `url.ts`.

**Browser state**: `sucvar_*` localStorage keys in `app/lib/storage.ts`; reactive reads via `app/lib/useStoredValue.ts`; language/theme from `usePrefs()`.

**Theming**: `app/lib/theme/{tokens,skin,usePrefs}`, `components/ui/Editorial.tsx`, `globals.css`.

## Environment (`.env.local`, see `.env.example`)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`), `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL` (server only, optional), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` (legal pages). No server secrets.
