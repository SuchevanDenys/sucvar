# SUCVAR

AI interior, exterior and garden design studio for the Romanian renovation market:
photo-to-redesign rendering, engineering take-off, retailer-linked bill of materials, and a B2B *devis* portal with
client approval links.

| Folder | Stack | Default port |
|---|---|---|
| [`backend/`](backend) | ASP.NET Core Web API, .NET 10, EF Core + PostgreSQL (Supabase), Stripe | `5080` |
| [`frontend/`](frontend) | Next.js 16, React 19, Tailwind 4 — UI only, no server secrets | `3000` |

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — layers, auth flow, data model, client portal security, billing lifecycle, Romanian market rules.
- **[MIGRATION_CONTRACT.md](MIGRATION_CONTRACT.md)** — every route, payload, error code and rate limit.

---

## Prerequisites

| Tool | Version |
|---|---|
| .NET SDK | 10.0 |
| Node.js | 24 LTS |
| pnpm | 12 (`corepack enable` picks the version pinned in `package.json`) |
| Supabase project | PostgreSQL + Auth (free tier is enough) |
| Stripe account | test mode; [Stripe CLI](https://stripe.com/docs/stripe-cli) for local webhooks |

## 1. Database

The schema is owned by SQL migrations in [`backend/db/migrations`](backend/db/migrations); the API never runs EF
migrations. All scripts are idempotent.

**Quickest:** open *Supabase → SQL Editor*, paste [`backend/db/setup_all.sql`](backend/db/setup_all.sql) and run it.
It applies everything below in order and ends with a verification query.

**Or individually, in order:**

| File | Adds |
|---|---|
| `001_sucvar_schema.sql` | `profiles`, `projects`, `ai_generations`, `b2b_estimates`, Row Level Security |
| `002_public_portal.sql` | public link + client approval columns on `projects` |
| `002b_billing_period.sql` | Stripe billing period on `profiles` |
| `003_company_profile_and_vat.sql` | `company_profiles` (contractor identity on the devis) |
| `004_user_profile_details.sql` | profile identity and B2B defaults |
| `005_admin_panel.sql` | roles, bans, bonus credits, `admin_audit_logs`, `app_settings` |
| `006_project_procurement_items.sql` | persisted bill of materials per project |
| `007_french_market_defaults.sql` | TVA 20 % and `paris` region defaults (superseded by 008) |
| `008_romanian_market_defaults.sql` | VAT 21 %, `bucharest` region and RON profile defaults (column defaults only, no row updates) |

## 2. Backend

```bash
cd backend
cp .env.example .env     # fill ConnectionStrings__Supabase, Supabase__Url, Stripe__*, Ai__*
dotnet build
dotnet run --project src/Sucvar.Api --urls http://localhost:5080
```

- Health: `GET http://localhost:5080/health`
- API reference (Development only): `http://localhost:5080/scalar/v1`
- No AI credentials? Leave `Ai__Provider` empty: the API falls back to a demo provider.

## 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL=http://localhost:5080
pnpm install
pnpm dev                     # http://localhost:3000
```

`/env-check` (development only) shows which public variables are configured.

## 4. Stripe (local)

```bash
stripe login
stripe listen --forward-to http://localhost:5080/api/webhooks/stripe
```

Copy the printed `whsec_…` into `backend/.env` as `Stripe__WebhookSecret` and restart the API. Pay from `/checkout`
with the test card `4242 4242 4242 4242`; the plan is activated by both the webhook and `/api/checkout/verify`.

For *Gérer l'abonnement* (Stripe Customer Portal), save the portal configuration once in the Stripe Dashboard:
*Settings → Billing → Customer portal*.

## 5. First administrator

After migration `005`, promote an account in the SQL editor, then sign in again:

```sql
update public.profiles set role = 'admin' where lower(email) = lower('you@example.com');
```

The account menu then shows **ADMIN** → `/admin` (KPIs, users and plans, portal moderation, settings, audit log).

## 6. Quality checks

```bash
# backend — must finish with 0 warnings and all tests green
cd backend
dotnet build
dotnet test

# frontend
cd frontend
pnpm lint
pnpm build
```

The backend suite includes golden-parity tests that replay fixtures generated from the original TypeScript rules.
If you change catalog data in `frontend/app/data/`, regenerate them with `backend/tools/golden/gen.cjs` and copy
`catalog.json` into `backend/src/Sucvar.Domain/Catalog/`.

## Configuration reference

| Backend (`backend/.env`) | Purpose |
|---|---|
| `ConnectionStrings__Supabase` | PostgreSQL connection string (privileged role; RLS is enforced in code) |
| `Supabase__Url` / `Supabase__JwtSecret` | JWT validation (JWKS from the project URL; legacy HS256 secret optional) |
| `Stripe__SecretKey` / `Stripe__WebhookSecret` | Payments and webhook signature verification |
| `Ai__Provider`, `Ai__ReplicateApiToken`, `Ai__SdApiUrl` | AI provider (`stable-diffusion` · `replicate` · `demo`) |
| `App__SiteUrl`, `Cors__AllowedOrigins`, `Proxy__KnownProxies` | Redirect base URL, allowed frontend origins, trusted reverse proxies |

| Frontend (`frontend/.env.local`) | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser sign-in (public key, protected by RLS) |
| `NEXT_PUBLIC_API_URL` / `API_INTERNAL_URL` | API base URL for the browser / for Server Components |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` | Share links, legal pages |

Both `.env.example` files document every variable in detail. Never commit real values.
