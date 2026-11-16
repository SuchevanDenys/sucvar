-- 008_romanian_market_defaults.sql
-- Revenire la piața românească (după 007_french_market_defaults.sql):
--   • TVA implicit 21 % (cota standard din 1 aug. 2025); 11 % (cota redusă) rămâne o alegere dintr-un click în UI.
--   • Regiunea implicită de calcul: 'bucharest' (București – Ilfov).
--   • Moneda implicită a profilului: RON (sumele stocate rămân în EUR; UI-ul le afișează în lei).
--   • company_profiles.vat_id = CUI / cod TVA (RO…); reg_no = Nr. Reg. Com. (J40/…/…).
-- NEDISTRUCTIV și IDEMPOTENT: modifică doar valorile DEFAULT pentru rândurile noi; nu face niciun UPDATE.

begin;

alter table public.b2b_estimates alter column vat_pct set default 21;
alter table public.b2b_estimates alter column region set default 'bucharest';

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'default_vat_rate') then
    alter table public.profiles alter column default_vat_rate set default 21;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'default_currency') then
    alter table public.profiles alter column default_currency set default 'RON';
  end if;
  if to_regclass('public.company_profiles') is not null then
    comment on column public.company_profiles.vat_id is 'CUI / cod de înregistrare în scopuri de TVA (ex. RO12345678) — TVA intracomunitar UE acceptat';
    comment on column public.company_profiles.reg_no is 'Nr. de ordine în Registrul Comerțului (ex. J40/1234/2020)';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
