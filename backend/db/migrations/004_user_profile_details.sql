-- ════════════════════════════════════════════════════════════════════════════════
-- SUCVAR — migrare 004: detalii profil utilizator + normalizarea `projects`     IDEMPOTENT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- CUM SE RULEAZĂ: după 001, 002, billing_period.sql și 003 → Supabase SQL Editor → Run.
-- (Numerotată 004 pentru că 003 = company_profiles + TVA 21% există deja.)
--
-- 1. PROFIL: avatar + setările implicite B2B ale utilizatorului (monedă, TVA, marjă), folosite de
--    pagina /account și de devizele noi. Datele firmei rămân în `company_profiles` (migrarea 003):
--    nu le duplicăm în `profiles`.
--
-- 2. NORMALIZARE `projects` (cauza linkului public /p/[id] care nu mergea):
--    tabelul exista înaintea migrării 001, deci `create table if not exists` nu l-a recreat:
--    `created_at` a rămas TEXT, fără valoare implicită. API-ul .NET funcționează și așa (citește coloana
--    prin conversie explicită), dar tipul corect este timestamptz — comparațiile de dată, indexul
--    (user_id, created_at desc) și ordonarea devin corecte și rapide.
--    Conversia este sigură: textele ISO se convertesc exact; orice valoare ilizibilă primește now().
--
-- 3. `profiles.cancel_at_period_end` devine NOT NULL DEFAULT false (era nullable în baza veche).
-- ════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. profiles: avatar + setări implicite ─────────────────────────────────────────
alter table public.profiles
  add column if not exists avatar_url             text,
  add column if not exists default_currency       text         not null default 'EUR',
  add column if not exists default_vat_rate       numeric(5,2) not null default 21,
  add column if not exists default_margin_percent numeric(5,2) not null default 15;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_defaults_check') then
    alter table public.profiles add constraint profiles_defaults_check check (
      default_currency in ('EUR', 'RON')
      and default_vat_rate between 0 and 100
      and default_margin_percent between 0 and 100
      and (avatar_url is null or char_length(avatar_url) <= 500)
    );
  end if;
end;
$$;

update public.profiles set cancel_at_period_end = false where cancel_at_period_end is null;
alter table public.profiles alter column cancel_at_period_end set default false;
alter table public.profiles alter column cancel_at_period_end set not null;

-- ── 2. projects.created_at: text → timestamptz ────────────────────────────────────
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'projects' and column_name = 'created_at') = 'text' then
    alter table public.projects
      alter column created_at type timestamptz
      using (case when created_at ~ '^\d{4}-\d{2}-\d{2}' then created_at::timestamptz else now() end);
  end if;
end;
$$;

update public.projects set created_at = now() where created_at is null;
alter table public.projects alter column created_at set default now();
alter table public.projects alter column created_at set not null;

-- Indexul din 001 (recreat dacă lipsea: pe baza veche, crearea lui a putut fi sărită)
create index if not exists projects_user_created_idx on public.projects (user_id, created_at desc);

commit;

notify pgrst, 'reload schema';
