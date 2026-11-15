-- 007_french_market_defaults.sql
-- Marché français (Paris & Île-de-France):
--   • TVA par défaut 20 % (taux normal) au lieu de 21 % (Roumanie) ; 10 % (rénovation > 2 ans) reste un choix en 1 clic.
--   • Région de chiffrage par défaut : 'paris'.
--   • company_profiles.vat_id = N° TVA intracommunautaire (FRxx + SIREN) ; reg_no = SIREN (9) / SIRET (14).
-- Idempotent : ne modifie que les valeurs par défaut, jamais les lignes existantes.

alter table public.b2b_estimates alter column vat_pct set default 20;
alter table public.b2b_estimates alter column region set default 'paris';

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'default_vat_rate') then
    alter table public.profiles alter column default_vat_rate set default 20;
  end if;
end $$;

comment on column public.company_profiles.vat_id is 'N° TVA intracommunautaire (ex. FR40303265045) — CUI RO accepté';
comment on column public.company_profiles.reg_no is 'SIREN (9 chiffres) ou SIRET (14 chiffres)';
