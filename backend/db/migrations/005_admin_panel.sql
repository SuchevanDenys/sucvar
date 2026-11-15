-- ════════════════════════════════════════════════════════════════════════════════
-- SUCVAR — migrare 005: panou de administrare                                  IDEMPOTENT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- CUM SE RULEAZĂ: după 001, 002, billing_period.sql, 003 și 004 → Supabase SQL Editor → Run.
-- (Numerotată 005 pentru că 004 = user_profile_details există deja.)
--
-- CE ADAUGĂ:
--   1. `profiles`: role ('user' | 'admin'), is_banned, banned_reason, bonus_generations (credite AI
--      acordate manual de un administrator), quota_reset_at (resetarea consumului lunar) + index pe role.
--   2. `admin_audit_logs`: jurnalul imuabil al fiecărei acțiuni administrative.
--   3. `app_settings`: configurarea platformei fără cod (limite pe plan, prețuri afișate, flag-uri).
--      Valorile implicite corespund EXACT codului (PlanTiers.cs: starter / pro / agency).
--
-- SECURITATE:
--   • Rolul, blocarea, creditele și setările se modifică EXCLUSIV prin API-ul .NET (/api/admin/**,
--     politica AdminOnly verificată în baza de date la fiecare cerere).
--   • `authenticated` NU are drept de INSERT/UPDATE/DELETE pe `profiles` (001) — reafirmat mai jos,
--     ca un utilizator să nu își poată acorda singur rolul 'admin' prin clientul Supabase.
--   • `admin_audit_logs` și `app_settings`: RLS activat FĂRĂ politici ⇒ inaccesibile pentru anon /
--     authenticated prin PostgREST; doar API-ul (conexiune directă) le citește și le scrie.
--
-- PRIMUL ADMINISTRATOR (manual, o singură dată, înlocuiește emailul):
--   update public.profiles set role = 'admin' where lower(email) = lower('admin@exemplu.ro');
-- ════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. profiles: rol + blocare + credite ───────────────────────────────────────────
alter table public.profiles
  add column if not exists role              text        not null default 'user',
  add column if not exists is_banned         boolean     not null default false,
  add column if not exists banned_reason     text,
  add column if not exists bonus_generations integer     not null default 0,
  add column if not exists quota_reset_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_banned_reason_check') then
    alter table public.profiles add constraint profiles_banned_reason_check
      check (banned_reason is null or char_length(banned_reason) <= 500);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass and conname = 'profiles_bonus_generations_check') then
    alter table public.profiles add constraint profiles_bonus_generations_check
      check (bonus_generations between 0 and 100000);
  end if;
end;
$$;

create index if not exists profiles_role_idx on public.profiles (role);

-- Utilizatorul autentificat poate doar CITI propriul rând (politica profiles_select_own din 001).
revoke insert, update, delete on public.profiles from authenticated;

-- ── 2. admin_audit_logs ────────────────────────────────────────────────────────────
create table if not exists public.admin_audit_logs (
  id            uuid        primary key default gen_random_uuid(),
  admin_user_id uuid        not null,
  admin_email   text,
  action        text        not null,
  target_type   text        not null,
  target_id     text        not null,
  details       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.admin_audit_logs'::regclass and conname = 'admin_audit_logs_action_check') then
    alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check (action in (
      'user.update_plan', 'user.adjust_quota', 'user.toggle_ban', 'user.change_role', 'project.unpublish', 'settings.update'
    ));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.admin_audit_logs'::regclass and conname = 'admin_audit_logs_target_type_check') then
    alter table public.admin_audit_logs add constraint admin_audit_logs_target_type_check
      check (target_type in ('user', 'project', 'settings'));
  end if;
end;
$$;

create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from anon, authenticated;

-- ── 3. app_settings ────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- Valori implicite = codul actual (PlanTiers.cs / PaidPlans): Starter 3 generări/lună, Pro și Agency nelimitat;
-- Pro 29 €/lună, Agency 79 €/lună, reducere anuală 20%. Nu suprascrie valori deja configurate.
insert into public.app_settings (key, value) values
  ('plan_limits', '{
     "starter": {"monthly_generations": 3},
     "pro":     {"monthly_generations": null},
     "agency":  {"monthly_generations": null}
   }'::jsonb),
  ('pricing_display', '{
     "currency": "EUR",
     "annual_discount_pct": 20,
     "starter": {"monthly_eur": 0},
     "pro":     {"monthly_eur": 29},
     "agency":  {"monthly_eur": 79}
   }'::jsonb),
  ('system_flags', '{
     "maintenance_mode": false,
     "allow_new_registrations": true,
     "estimated_render_cost_eur": 0.04
   }'::jsonb)
on conflict (key) do nothing;

commit;

notify pgrst, 'reload schema';
