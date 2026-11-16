# SUCVAR — Migration Contract (source of truth for Phases 1–3)

Reference monolith: `licenta-denys/` (Next.js 16.4.1, React 19.3, pnpm 12.11.2) — **read-only**.
Targets: `backend/` (ASP.NET Core Web API, .NET 10.0.404 SDK / runtime 10.0.15) and `frontend/` (decoupled Next.js).
Environment at audit time: .NET SDK 10.0.404 (osx-arm64), Node v24.19.0, pnpm 12.11.2.

## 1. Plans (`app/lib/plan/tiers.ts`, `app/types/plan.ts`)

| Item | Value |
|---|---|
| `PlanTier` | `'starter' \| 'pro' \| 'agency'` (DB CHECK `profiles_tier_check`) |
| `normalizeTier` | trim+lower; `agency\|enterprise\|business` → `agency`; `pro\|professional` → `pro`; else `starter` |
| Unlimited generations | `pro`, `agency` (`isUnlimitedTier`) |
| B2B access (EnterpriseGate) | `agency` only (`hasB2bAccess`) — on the **effective** tier |
| Starter limit | `PLAN_LIMITS.starterMonthlyGenerations = 3` per UTC calendar month |
| Effective tier | paid tier with `current_period_end < now` → `starter`; missing date keeps tier |
| `TIER_RANK` | starter 0, pro 1, agency 2 |
| `canPurchase(cur, req)` | cur starter → true; rank(req) > rank(cur) → true; same tier & req year & cur ≠ year → true; else false |
| Billing interval | `'month' \| 'year'`; annual = round(monthly×12×0.8) cents |
| Stripe prices (`billing/stripe.ts`) | pro "SUCVAR Professional" 2900c; agency "SUCVAR Business" 7900c; currency `eur`; optional env `STRIPE_PRICE_{PRO\|AGENCY}_{MONTH\|YEAR}` |

## 2. Database (`supabase/migrations/001`, `002`, `sql/billing_period.sql`) — NO EF migrations

**profiles**: `id uuid PK (auth.users)`, `email text`, `full_name text`, `subscription_tier text NOT NULL default 'starter'`, `stripe_customer_id text`, `stripe_subscription_id text`, `current_period_end timestamptz`, `billing_interval text ('month'|'year'|null)`, `cancel_at_period_end bool NOT NULL default false`, `created_at timestamptz`, `updated_at timestamptz` (trigger `set_updated_at`).

**projects**: `id text PK default gen_random_uuid()::text`, `user_id uuid`, `user_email text NOT NULL ''`, `title text`, `mode text (interiors|exteriors|gardens)`, `space_type text`, `style_id text`, `dimensions jsonb`, `original_image text`, `generated_image text`, `total_budget numeric(12,2) ≥0`, `created_at`, `updated_at` + (002) `is_public bool NOT NULL default false`, `client_status text NOT NULL default 'pending' (pending|approved|changes_requested)`, `client_feedback text (≤500)`, `client_reviewed_at timestamptz`.

**ai_generations**: `id uuid PK default gen_random_uuid()`, `user_id uuid NOT NULL`, `provider text`, `mode text`, `created_at timestamptz`.

**b2b_estimates**: `id uuid PK`, `user_id uuid NOT NULL`, `project_id text FK projects(id) cascade`, `doc_no text`, `status text (draft|sent|accepted|rejected)`, `client jsonb`, `region text`, `finish_level text`, `area_m2 numeric(12,2)`, `crew int ≥1`, `contingency_pct numeric(5,2)`, `margin_pct numeric(5,2)`, `vat_pct numeric(5,2) 0–100 default 19`, `scope jsonb`, `rate_override jsonb`, `line_items jsonb (array)`, `subtotal numeric(12,2)`, `total numeric(12,2)`, `created_at`, `updated_at`. Unique partial index `(user_id, project_id) where project_id is not null`.

RLS exists but the .NET backend connects directly (service role / postgres) ⇒ **every query filters `user_id` explicitly**.

## 3. Error envelope & HTTP helpers (`app/lib/server/http.ts`)

- All errors: `{ "error": string, "code": string, ...extra }`.
- 429: `{ code:"RATE_LIMITED", error:"Prea multe cereri. Încearcă din nou în {n}s. / Too many requests. Please try again in {n}s.", retryAfter:n }` + header `Retry-After`.
- 413: `{ code:"PAYLOAD_TOO_LARGE", error:"Cererea este prea mare. / Request payload too large." }` (Content-Length check, then real length).
- Bearer: `Authorization: Bearer <supabase access_token>`; 401 `AUTH_REQUIRED` ("Autentifică-te pentru a continua.") / `AUTH_INVALID` ("Sesiune invalidă. Autentifică-te din nou."); 500 `NOT_CONFIGURED`.
- Client IP: first `x-forwarded-for`, else `x-real-ip`, else `unknown`.
- Rate limit: fixed window in memory, key `{rule}:{identity}`, max 10 000 buckets.

## 4. Routes

| # | Route | Methods | Auth | Rate limits | Body cap |
|---|---|---|---|---|---|
| 1 | `/api/generate` | POST | Bearer (anon only if `ALLOW_ANON_GENERATION=true`) | `generate:ip` 30/60s, `generate:user` 6/60s | 6 000 000 + 100 000 |
| 2 | `/api/analyze-materials` | POST | Bearer | `materials:ip` 30/60s, `materials:user` 12/60s | 16 000 |
| 3 | `/api/checkout` | POST | Bearer (email required) | `checkout:ip` 30/600s, `checkout:user` 8/600s | 2 000 |
| 4 | `/api/checkout/verify` | POST | Bearer | `verify:ip` 60/600s, `verify:user` 30/600s | 2 000 |
| 5 | `/api/webhooks/stripe` | POST | Stripe-Signature (anonymous) | — | raw |
| 6 | `/api/b2b/estimates` | GET, PUT, DELETE | Bearer; GET/PUT require effective `agency` (403 `AGENCY_REQUIRED` + `currentTier`); DELETE only auth | `estimates:write` 60/600s (PUT) | 400 000 |
| 7 | `/api/projects/sharing` | GET, PATCH | Bearer | `sharing:write` 30/600s (PATCH) | 1 000 |
| 8 | `/api/public/projects/{id}` | GET | anonymous | `portal:read` 60/60s per IP | — |
| 9 | `/api/public/projects/{id}/review` | POST | anonymous | `portal:review:ip` 10/600s, `portal:review:project` 3/600s per (IP,id) | 4 000, `Content-Type: application/json` else 415 |
| + | `/health` (new) | GET | anonymous | — | — |

No `/api/env-check` route exists — `/env-check` is a dev-only **page** reading `NEXT_PUBLIC_*` vars.

### 4.1 POST /api/generate
Request: `{ image: dataURL, mode, spaceType, styleId, dimensions: RoomDimensions, ai: { extraPrompt, negativePrompt, inferenceSteps, guidanceScale, seed } }`.
Order: IP limit → quota (auth/plan/limit) → user limit (userId ?? IP) → body cap → JSON.
Errors: 400 `INVALID_JSON`, 400 `IMAGE_REQUIRED`, 413 `IMAGE_TOO_LARGE` (> 6 000 000 chars), 415 `IMAGE_FORMAT` (regex `^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$`), 422 `IMAGE_DIMENSIONS` (side 64–8192, ≤ 40 MP), 415 `IMAGE_CORRUPT`, 502 `AI_NO_IMAGE`, 500 `GENERATION_FAILED`.
Quota errors: `{ error, code, used?, limit? }` — 401 `AUTH_REQUIRED`/`AUTH_INVALID`, 403 `LIMIT_REACHED` (used, limit), 500 `QUOTA_CHECK_FAILED` / `NOT_CONFIGURED`.
Starter usage = max(projects created this UTC month by user_id, ai_generations this month).
Prompt: segments [scenePrompt, scenarios, scope prompt, styleSpecPrompt, cleaned style prompt, extraPrompt(≤400), layout prompt, budget details, lighting, quality tail], CLIP budget 72 tokens (≈1.25/word + commas). Negative = merge(user negative(≤600) or default, mandatory). Steps 10–60 (default 30), guidance 1–20 (7.5), seed 0..2147483647 or random, prompt_strength = clamp(aiStrength 40–100 → /100, 0.45–0.9).
Response 200: `{ result, imageUrl, generatedImage, isDemo, promptUsed, warning? }` (permanent JPEG data URL, max width 1280, quality 82). Demo: 2 s delay, Unsplash image per mode.
Replicate model `adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38`. Log `ai_generations` after the provider returns an image.

**Smart Studio contract (v4, additive).** Optional fields: `customPrompt` (free text RO/EN, trimmed, ≤ 1000 chars), `style` (alias of `styleId`; omitted / `""` / `"auto"` = infer from text), `palette` (`warm_neutral|monochrome|earthy|cool_grey|dark_moody|light_airy`), `lighting` (`natural|golden_hour|evening|studio|dramatic`), `roomType` (alias of `spaceType`; omitted = inferred from text, else first space), `areaSqm` (1–10 000, default 20), `preserveStructure` (bool, default `true`).
Validation (after the image checks): 400 `PROMPT_OR_STYLE_REQUIRED` when both `customPrompt` and `style`/`styleId` are empty, 400 `PROMPT_TOO_LONG` (> 1000), 400 `INVALID_PROMPT` (not a string).
When any v4 field is present (or no style is given) the **Smart Prompt Synthesizer** (`GenerationPrompt.SynthesizePrompt`, `DesignVision`) builds the prompt: compact scene → materials recognised in the text (English terms) → structure cue (`keep existing walls, windows and doors` / `completely redesigned layout`) → the user's words (verbatim if English, glossary-translated if Romanian) → palette → lighting (replaces the auto daylight cue) → style → scenarios/scope/extraPrompt → layout (only when preserving) → budget (only without materials/palette) → `photorealistic 8k architectural (interior) photography, accurate perspective, …` (always kept); terms de-duplicated, 72-token budget. preserveStructure=true caps prompt_strength at 0.8 and adds structure negatives; false raises it to ≥ 0.8. Legacy payloads (styleId + dimensions + ai only) keep the exact historical prompt (golden tests).
Response adds `vision: { customPrompt, styleId, styleInferred, palette, lighting, spaceType, spaceInferred, areaSqm, preserveStructure, materials:[{id,slot,titleRo,titleEn}] }` on the smart path.

### 4.2 POST /api/analyze-materials
Request `{ mode, spaceType, styleId, dimensions }` → `{ bom: { items: BomItem[], total, currency:"EUR" } }`.
`BomItem = { id, cat, procCategory, titleRo, titleEn, specRo, specEn, qty, unit, unitPrice, total, query, links:[{retailer,label,url}] }`.
Errors: 400 `INVALID_JSON`, `INVALID_BODY`, `INVALID_SPACE`, `INVALID_STYLE`; 500 `INTERNAL_ERROR`.
v4 (additive): optional `customPrompt` (≤ 1000) — recognised materials (oak, walnut, herringbone, travertine, marble, microcement, limewash, wood slats, brick, LED strips, pendants, linen/velvet/leather sofa, rattan, matte black, brass, quartz, plants, rugs, curtains…) replace the generic item of their slot or are added with their own Dedeman / IKEA / Leroy Merlin / Hornbach search, flagged `fromPrompt: true` and listed first (max 10 items). `styleId` may be omitted/`"auto"` when `customPrompt` is given (inferred, fallback first style); `roomType` aliases `spaceType`; `areaSqm` is used when `dimensions` is absent (4:5 room). Response then adds `vision: { styleId, styleInferred, materials }`. Without `customPrompt` the response is unchanged.
Saved projects keep the Studio brief in `projects.dimensions.brief` (`{ customPrompt, preserveStructure, palette, lighting, styleAuto }`, no migration); the public portal exposes only `designBrief` (the cleaned text).

### 4.3 POST /api/checkout
Request `{ plan: 'pro'|'agency', interval?: 'month'|'year' }` → `{ url }`.
Errors: 500 `NOT_CONFIGURED`, 401 `AUTH_REQUIRED`/`AUTH_INVALID` ("Autentifică-te pentru a plăti."), 400 `INVALID_PLAN`, 400 `INVALID_INTERVAL`, 409 `{ code: ALREADY_SUBSCRIBED|PLAN_INCLUDED, error, currentTier, redirect: '/b2b'|'/generate' }`, 502 `NO_CHECKOUT_URL`, 500 `CHECKOUT_FAILED`.
Session: mode subscription, `customer` (if stripe_customer_id) else `customer_email`, `client_reference_id=userId`, metadata `{user_id, plan, interval}` on session + subscription_data, success `{site}/checkout/success?session_id={CHECKOUT_SESSION_ID}`, cancel `{site}/checkout?plan=…&interval=…&canceled=1`.

### 4.4 POST /api/checkout/verify
Request `{ session_id: "cs_…" }` → `{ paid:true, tier }` or `{ paid:false, status: payment_status }`.
Errors: 500 `NOT_CONFIGURED`, 401, 400 `INVALID_SESSION`, 403 `SESSION_MISMATCH`, 500 `VERIFY_FAILED`.

### 4.5 POST /api/webhooks/stripe
Raw body + `Stripe-Signature`. 500 `{error:"Webhook neconfigurat."}`, 400 `{error:"Lipsește semnătura Stripe."}`, 400 `{error:"Semnătură invalidă."}`, 500 `{error:"Procesare eșuată."}` (Stripe retries), 200 `{received:true}`.
Events: `checkout.session.completed` (paid → applyPaidSession), `customer.subscription.updated` (active/trialing → sync; canceled/unpaid/incomplete_expired → downgrade if current), `invoice.paid` (parent.subscription_details.subscription → sync if active), `customer.subscription.deleted` (downgrade if current).
applyPaidSession: read subscription period (min item `current_period_end`, interval from price.recurring then metadata, cancel_at_period_end), remember previous subscription id, write tier+ids+period (insert profile if missing), cancel previous subscription when different.

### 4.6 /api/b2b/estimates
GET → `{ estimates: EstimateRecord[] }` (≤ 50, updated_at desc). PUT body = `EstimatePayload` → `{ estimate }` (update existing by (user_id, project_id) or insert). DELETE `?id=<uuid>` → `{ deleted:true }` / 404 `NOT_FOUND` "Devizul nu există." / 400 `INVALID_ID`.
`EstimateRecord = { id, projectId, docNo, status, client{name,vatId,email,phone,address,siteAddress,notes}, region, finishLevel, areaM2, crew, contingencyPct, marginPct, vatPct, scope, rateOverride, lineItems[{id,cat,ro,en,unit,qty,price}], subtotal, total, createdAt, updatedAt }`.
Parsing (`server/estimates.ts`): project id `^[\w.:-]{1,128}$`, ≤ 500 items, clamps & truncations exactly as source. Errors 400 `INVALID_ESTIMATE`, DB errors → 409 `CONFLICT`, 400 `INVALID_REFERENCE`, 400 `CONSTRAINT_VIOLATION`, 503 `MIGRATION_REQUIRED`, 500 `DB_ERROR`.

### 4.7 /api/projects/sharing
GET `?id=` (optional, project id pattern else 400 `INVALID_ID`) → `{ migrated, items: ProjectSharing[] }` (≤ 200, created_at desc), `Cache-Control: private, no-store`.
PATCH `{ projectId, isPublic }` → `{ sharing }`; 400 `INVALID_JSON`/`INVALID_ID`/`INVALID_BODY`, 404 `NOT_FOUND` ("Proiectul nu există în cloud. Salvează-l în Supabase înainte de a-l partaja.").
`ProjectSharing = { projectId, isPublic, clientStatus, clientFeedback, clientReviewedAt }`.

### 4.8 GET /api/public/projects/{id}
200 `{ project: PublicProject }` (`Cache-Control: private, no-store`) · 400 `INVALID_ID` "Link invalid." · 404 `NOT_FOUND` "Proiect privat sau inexistent." (private and missing identical).
`PublicProject = { id, reference, title, mode, spaceType, styleId, dimensions{width,length,height,doorsCount,windowsCount}, areaM2, originalImage, generatedImage, materials[{category,nameRo,nameEn,unit,qty}], clientTotal, vatIncluded, clientStatus, clientReviewedAt, createdAt }`.
Never exposed: user_id, user_email, margin/contingency, rate overrides, scope, client notes, subtotal, unit prices.

### 4.9 POST /api/public/projects/{id}/review
Body `{ status: 'approved'|'changes_requested', feedback?: string }` → `{ clientStatus, clientReviewedAt }` (`Cache-Control: no-store`). Feedback: strip C0/C1 controls except \t \n \r, trim, ≤ 500 chars. Errors 400 `INVALID_ID`/`INVALID_JSON`/`INVALID_BODY`/`INVALID_STATUS`/`INVALID_FEEDBACK`/`FEEDBACK_TOO_LONG`, 404, 413, 415 `UNSUPPORTED_MEDIA_TYPE`, 429.

## 5. Frontend call sites to rewire
`app/generate/page.tsx`, `app/checkout/page.tsx`, `app/checkout/success/page.tsx`, `app/components/studio/ProcurementPanel.tsx`, `app/lib/portal/client.ts` (sharing + review), `app/lib/b2b/cloud.ts`, `app/p/[id]/page.tsx` (server component, previously read DB directly). Pure shared modules kept in the frontend: `procurement.ts` (offline fallback), `plan/tiers.ts`, AI limits (`ai/config.ts` → moved, since UI imports it).

## 6. Post-migration hardening (thesis release)

Deliberate, documented deviations from the monolith:

| Change | Where | Why |
|---|---|---|
| `POST /api/billing/portal` → `{ url }` (401, 404 `NO_CUSTOMER`, 429, 500 `PORTAL_FAILED`) | `BillingEndpoints.Portal`, `SubscriptionCard` | Self-service cancel / card / invoices (Stripe Customer Portal). Cancellation flows back through the existing webhook. |
| `POST /api/checkout` requires `acceptTerms: true` → else 400 `TERMS_REQUIRED`; `terms_accepted_at` stored in Stripe metadata | `BillingEndpoints.Checkout`, `checkout/page.tsx` | Terms + express consent to immediate start of a digital service (14-day withdrawal right), enforced on the server. |
| `GET /api/b2b/company` (auth) · `PUT /api/b2b/company` (agency, 4 KB, `company:write` 30/600s) | `B2bEndpoints`, `lib/b2b/company.ts`, table `company_profiles` | Contractor company data was localStorage-only. CUI checked with the ANAF control digit, IBAN with mod-97 (400 `INVALID_VAT_ID` / `INVALID_IBAN` / `INVALID_EMAIL`). |
| Default VAT 21% (was 19% on the server, 21% in the UI) | `EstimateParser.DefaultVatPct`, migration 003 | Romanian standard rate since 1 Aug 2025; removes the UI/API inconsistency. |
| `504 AI_TIMEOUT` when the model exceeds `Ai:GenerationBudgetSeconds` (80 s); the Replicate prediction is cancelled; nothing is journaled | `ReplicateImageProvider`, `StudioEndpoints` | Browser now aborts at 120 s, so the client never gives up on a render the server still bills. |
| Client IP for rate limiting honours `X-Forwarded-For` only from `Proxy:KnownProxies` (right-most untrusted hop) | `HttpHelpers.ClientIp`, `ProxyOptions` | The monolith trusted the header from anyone ⇒ limits were trivially bypassable. `/p/[id]` SSR forwards the visitor IP. |
| Production startup guards (anon generation, trust-all proxies, localhost/`*` CORS ⇒ refuse to start) | `StartupGuards` | Fail fast on configurations that are only valid on a developer machine. |

New SQL migration: `backend/db/migrations/003_company_profile_and_vat.sql` (run after 001 + 002).
Frontend additions: `/termeni`, `/confidentialitate`, `/rambursare`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `robots.txt`, `sitemap.xml`, OpenGraph metadata; the footer no longer shows invented uptime/latency figures.

## 7. Real-database fixes + user profile

**Root cause of the broken public link `/p/[id]`:** in the production Supabase database `public.projects` predates
migration 001 (`create table if not exists` skipped it). There `created_at` is **TEXT** (no default) and `mode`,
`space_type`, `style_id`, `dimensions`, `total_budget` are nullable; `profiles.cancel_at_period_end` is nullable.
EF Core mapped `created_at` as `timestamptz` ⇒ reading it threw ⇒ `GET /api/public/projects/{id}` answered
500 `DB_ERROR` and the portal page showed "Proiect privat sau inexistent". The same column broke the Starter quota
(`text >= timestamptz`, Postgres 42883 ⇒ 500 `QUOTA_CHECK_FAILED` on `/api/generate`).

Fix (works BEFORE and AFTER migration 004): `created_at` is no longer mapped in EF; queries that need it use
`ProjectSql` (`created_at::text::timestamptz`, valid for both column types); nullable columns are nullable in C#.
Verified against the real database: `GET /api/public/projects/2efaa613…` → 200 with the full projection.

| Endpoint | Contract |
|---|---|
| `GET /api/profile` (auth) | `{ account{userId,email,fullName,avatarUrl,initials,createdAt}, company\|null, canEditCompany, defaults{currency,vatRate,marginPercent}, subscription{tier,interval,currentPeriodEnd,cancelAtPeriodEnd,canManageBilling}, usage{generationsUsed,generationsLimit\|null,periodStart,projectsTotal,projectsPublic,estimatesTotal}, projects[{id,title,mode,spaceType,styleId,createdAt,hasImage,isPublic,clientStatus,clientFeedback,clientReviewedAt}], migrated }` |
| `PUT /api/profile` (auth, 6 KB, `profile:write` 30/600s) | body `{ fullName?, avatarUrl? (https only), defaults?{currency EUR\|RON, vatRate 0–100, marginPercent 0–100}, company? (agency only) }` → same shape as GET · 400 `INVALID_*` · 403 `AGENCY_REQUIRED` · 503 `MIGRATION_REQUIRED` |
| `POST /api/billing/portal` | (already added in §6) |

Name/avatar fall back to the Google `user_metadata` claim of the JWT. Company data stays in `company_profiles` (003) —
not duplicated in `profiles`.

New SQL: `backend/db/migrations/004_user_profile_details.sql` (avatar + B2B defaults in `profiles`; converts
`projects.created_at` TEXT → timestamptz safely; `cancel_at_period_end` NOT NULL). `backend/db/setup_all.sql`
contains 001 → 004 plus a verification query.

Frontend: `/account` (4 sections: identity · company & B2B defaults · subscription & AI quota · portfolio & client links),
`/profile` → 308 `/account`, Navbar "Profil"; `ShareControl` offers **"Salvează în cloud pentru a partaja"** for
local-only projects in Studio and B2B (saves to Supabase, then enables the public link in one click).

## 8. Admin panel (migration 005)

New SQL: `backend/db/migrations/005_admin_panel.sql` (also appended to `setup_all.sql`):
`profiles.role` ('user'|'admin', indexed), `is_banned`, `banned_reason` (≤500), `bonus_generations` (admin AI credits, 0–100 000),
`quota_reset_at`; tables `admin_audit_logs` (RLS on, no policies) and `app_settings` (RLS on, no policies) seeded with
`plan_limits`, `pricing_display`, `system_flags` = the values hard-coded in `PlanTiers.cs`. The new `profiles` columns are read with
raw SQL and fall back to defaults, so the API keeps working before 005 is applied (nobody is admin / banned until then).

First admin: `update public.profiles set role = 'admin' where lower(email) = lower('<email>');`

**Authorization**: policy `AdminOnly` (`Sucvar.Api/Auth/AdminAuthorization.cs`) = valid JWT + `role = 'admin'` + `is_banned = false`,
re-read from PostgreSQL on every request (never from the token). Failures keep the `{ error, code }` envelope: 401 `AUTH_REQUIRED` /
`AUTH_INVALID`, 403 `ADMIN_REQUIRED` / `ACCOUNT_BANNED`, 503 `ADMIN_CHECK_FAILED`.

**Ban + maintenance guard** (`AccountGuardFilter`, `.RequireActiveAccount()`): `/api/generate`, `/api/analyze-materials`, `/api/b2b/**`,
`/api/projects/sharing`, `/api/checkout` → 403 `ACCOUNT_BANNED` `{ reason }`; `system_flags.maintenance_mode` → 503 `MAINTENANCE` for
non-admins. Deliberately NOT guarded: `/api/profile`, `/api/billing/portal`, `/api/checkout/verify`, Stripe webhook, public portal.
`RequireAgency` (`/api/b2b/**`) also admits active admins (replaces the UX-only `NEXT_PUBLIC_ADMIN_EMAILS`).

**Quota**: limit = `app_settings.plan_limits[tier]` (null = unlimited) + `bonus_generations`; usage counted from
max(UTC month start, `quota_reset_at`) (`QuotaPolicy`). Settings are cached 30 s per API instance.

| Route | Contract |
|---|---|
| `GET /api/profile` | + `role`, `isBanned`, `bannedReason`, `usage.bonusGenerations` |
| `GET /api/public/status` (anon) | `{ maintenanceMode, allowNewRegistrations }` |
| `GET /api/admin/overview` | `{ totalUsers, newUsersLast30Days, bannedUsers, admins, subscribersByPlan{starter,pro,agency}, payingSubscribers, estimatedMrrEur, rendersToday, rendersThisMonth, totalRenders, estimatedRenderCostEur, estimatedApiCostEur, estimatedNetMarginEur, totalProjects, publicProjectsCount, totalB2bEstimates, systemHealth{database,stripe,replicate,aiProvider}, generatedAt }` |
| `GET /api/admin/users?q&plan&role&banned&page&pageSize` | `{ items: AdminUser[], total, page, pageSize }` (≤100/page; q matches email, full name, company name, exact id) |
| `PATCH /api/admin/users/{id}` | body `{ plan?, quotaDelta? (±1–1000), resetQuota?, role?, isBanned?, bannedReason? }` → `{ user }` · 400 `SELF_PROTECTION` (self ban / demote), `EMPTY_PATCH`, `INVALID_*` · 404 |
| `GET /api/admin/public-projects?q&page&pageSize` | `{ items: [{ id, title, mode, ownerId, ownerEmail, clientStatus, clientFeedback, clientReviewedAt, createdAt, thumbnail }], total, page, pageSize }` (≤24/page) |
| `POST /api/admin/public-projects/{id}/unpublish` | `{ unpublished: true, projectId }` · 404 when missing / already private |
| `GET /api/admin/audit-logs?page&pageSize` | newest first, ≤100/page |
| `GET` / `PUT /api/admin/settings` | `{ settings{ planLimits, pricingDisplay, systemFlags }, migrated }`; PUT is partial · 400 `INVALID_SETTINGS` · 503 `MIGRATION_REQUIRED` |

Every mutation writes its `admin_audit_logs` row in the same transaction (`user.update_plan`, `user.adjust_quota`, `user.toggle_ban`,
`user.change_role`, `project.unpublish`, `settings.update`); mutations are rate limited `admin:write` 120/600 s per admin.
A manual plan change does not touch Stripe billing (the next `invoice.paid` webhook re-syncs a Stripe-managed plan).


## 8. Procurement links in the archive + client price transparency

New SQL: `backend/db/migrations/006_project_procurement_items.sql` (`projects.procurement_items jsonb`, array CHECK; also appended to `setup_all.sql`).

| Endpoint | Contract |
|---|---|
| `GET /api/profile` | each `projects[]` entry also has `procurementItems: BomItem[]`, `procurementTotal`, `procurementPersisted` (saved list, or recomputed with `BomBuilder` when the column is NULL / missing) |
| `GET /api/projects/{id}/procurement` (auth, owner) | `{ procurement: { projectId, items: BomItem[], total, currency, persisted } }` · 400 `INVALID_ID` · 404 `NOT_FOUND` |
| `POST /api/projects/{id}/procurement` (auth, owner, `procurement:write` 30/600s) | recomputes + stores the list (backfill); `persisted:false` when 006 is not applied |
| `GET /api/public/projects/{id}` | adds `items[{id,category,name,nameEn,quantity,unit,clientUnitPrice,clientLineTotal,retailerName,retailerUrl,links[]}]` and `pricingBreakdown{materialsSubtotal,laborSubtotal,vatRate,vatAmount,grandTotal,currency,pricingSource:'b2b_quote'\|'studio_estimate'}` |

Pricing (server only, `PublicProjection.Pricing`): B2B line price = purchase price × (1+contingency) × (1+margin) (capped so materials ≤ net); labour = net − materials; VAT = total − net. Without a quote: Studio market prices, labour = Studio estimate − materials, VAT 21 %. Purchase prices, margin/contingency %, rates and `user_id` never appear in the payload. Stored retailer URLs are never echoed: links are rebuilt from `query` (Dedeman / IKEA / Leroy Merlin / Hornbach only).

## 9. Romanian market (migration 008)

New SQL: `backend/db/migrations/008_romanian_market_defaults.sql` (also appended to `setup_all.sql`). It changes **column
defaults only** (no `UPDATE`): `b2b_estimates.vat_pct` 21, `b2b_estimates.region` `'bucharest'`,
`profiles.default_vat_rate` 21, `profiles.default_currency` `'RON'`; RO comments on `company_profiles.vat_id/reg_no`.

| Change | Where |
|---|---|
| Retailer links: Dedeman · Leroy Merlin · Hornbach · Brico Dépôt · IKEA România · Mobexpert, Romanian `query` used verbatim (supersedes the French routing of §8 and of 007) | `RomanianRetail.cs` ↔ `frontend/app/lib/retailers.ts` |
| Default VAT 21 %, one-click 11 %; default region `bucharest` | `EstimateParser.DefaultVatPct` / `RomanianVatRates` / `DefaultRegion`, `EstimateDefaults.VatPct`, `lib/b2b/estimate.ts` |
| Profile defaults `("RON", 21, 15)`; missing `defaults.currency` in `PUT /api/profile` → `RON` | `ProfileDefaults.Initial`, `ProfileUpdateParser` |
| API amounts and `currency` fields stay **EUR** (contract unchanged); the UI shows lei with a fixed `EUR_TO_RON` rate | `frontend/app/lib/format.ts` |
