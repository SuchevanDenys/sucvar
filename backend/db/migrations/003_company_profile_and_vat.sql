-- ════════════════════════════════════════════════════════════════════════════════
-- SUCVAR — migrare 003: profilul firmei antreprenorului + TVA implicită 21%   IDEMPOTENT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- CUM SE RULEAZĂ: după 001 și 002 (proiectul de referință, supabase/migrations/),
-- în Supabase Dashboard → SQL Editor → Run. Nu șterge și nu rescrie date.
--
-- DE CE:
--   1. Datele firmei (furnizorul de pe deviz / Factur-X) erau păstrate DOAR în localStorage:
--      se pierdeau la schimbarea dispozitivului sau ștergerea datelor browserului.
--      Acum stau în `company_profiles`, 1 rând per utilizator (cheie = user_id).
--   2. Cota standard de TVA în România este 21% (din 1 august 2025). Interfața /b2b folosea deja
--      21%, dar baza de date și API-ul aveau implicit 19% → valori incoerente pentru devize noi.
--
-- SECURITATE (același model ca 001):
--   • RLS activat; utilizatorul autentificat poate doar CITI propriul rând.
--   • Scrierea se face exclusiv prin API (.NET), care validează CUI (cifra de control) și IBAN (mod-97)
--     și filtrează explicit pe user_id. `anon` nu are acces.
-- ════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.company_profiles (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  name       text        not null default '',
  vat_id     text        not null default '',   -- CUI / cod TVA (ex. RO12345678)
  reg_no     text        not null default '',   -- Nr. Registrul Comerțului (ex. J40/1234/2020)
  address    text        not null default '',
  iban       text        not null default '',
  bank       text        not null default '',
  email      text        not null default '',
  phone      text        not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.company_profiles'::regclass and conname = 'company_profiles_len_check') then
    alter table public.company_profiles add constraint company_profiles_len_check check (
      char_length(name) <= 200 and char_length(vat_id) <= 40 and char_length(reg_no) <= 40 and
      char_length(address) <= 300 and char_length(iban) <= 34 and char_length(bank) <= 100 and
      char_length(email) <= 200 and char_length(phone) <= 40
    );
  end if;
end;
$$;

drop trigger if exists company_profiles_set_updated_at on public.company_profiles;
create trigger company_profiles_set_updated_at before update on public.company_profiles
  for each row execute function public.set_updated_at();

alter table public.company_profiles enable row level security;
revoke all on public.company_profiles from anon;
revoke insert, update, delete on public.company_profiles from authenticated;

drop policy if exists "company_profiles_select_own" on public.company_profiles;
create policy "company_profiles_select_own" on public.company_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

-- TVA implicită coerentă cu interfața și cu API-ul (devizele existente NU se modifică)
alter table public.b2b_estimates alter column vat_pct set default 21;

commit;

notify pgrst, 'reload schema';
