# SUCVAR — decoupled

| Folder | What | Port |
|---|---|---|
| `licenta-denys/` | Original Next.js monolith (reference, untouched) | — |
| `backend/` | ASP.NET Core Web API, .NET 10 (`Sucvar.Api.slnx`) | 5080 |
| `frontend/` | Next.js 16 UI (no server code) | 3000 |

`MIGRATION_CONTRACT.md` lists every route, contract, limit and table.

## 1. Database (once)
Apply in the Supabase SQL editor, in order: `licenta-denys/supabase/migrations/001_sucvar_schema.sql`, `002_public_portal.sql`, `licenta-denys/sql/billing_period.sql`, then `backend/db/migrations/003_company_profile_and_vat.sql`, `004_user_profile_details.sql` and `005_admin_panel.sql` — or simply run **`backend/db/setup_all.sql`** (all of them, idempotent, ends with a verification query). The API never runs EF migrations.

Stripe Customer Portal ("Gestionează abonamentul"): in the Stripe Dashboard (test mode) open **Settings → Billing → Customer portal** and save the configuration once, otherwise Stripe refuses to create portal sessions.

## 2. Backend
```bash
cd backend
cp .env.example .env        # fill ConnectionStrings__Supabase, Supabase__Url, Stripe__*, Ai__*
dotnet build
dotnet test
dotnet run --project src/Sucvar.Api --urls http://localhost:5080
```
Health: `GET http://localhost:5080/health` · API docs (Development): `http://localhost:5080/scalar/v1`.

## 3. Frontend
```bash
cd frontend
cp .env.example .env.local  # NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL=http://localhost:5080
pnpm install
pnpm dev                    # http://localhost:3000
```

## 4. Stripe webhook (local)
```bash
stripe login
stripe listen --forward-to http://localhost:5080/api/webhooks/stripe
```
Copy the printed `whsec_…` into `backend/.env` as `Stripe__WebhookSecret`, restart the API, then:
```bash
stripe trigger checkout.session.completed
```
(The triggered fixture has no `user_id`/`plan` metadata, so the API answers `200 {received:true}` and ignores it; a real checkout from `/checkout` with test card `4242 4242 4242 4242` activates the plan through both the webhook and `/api/checkout/verify`.)

## 5. Admin panel
Run `backend/db/migrations/005_admin_panel.sql` (or `setup_all.sql`), then promote the first administrator in the SQL editor:
```sql
update public.profiles set role = 'admin' where lower(email) = lower('you@example.com');
```
Sign in again (or reload) — the account menu shows **ADMIN** → `/admin`. Contract: `MIGRATION_CONTRACT.md` §8.

