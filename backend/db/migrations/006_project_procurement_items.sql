-- ════════════════════════════════════════════════════════════════════════════════
-- SUCVAR — migrare 006: lista de materiale & linkuri de achiziție salvată cu proiectul   IDEMPOTENT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- CUM SE RULEAZĂ: după 001 … 005 → Supabase SQL Editor → Run. Se poate rula de mai multe ori.
--
-- CE ADAUGĂ:
--   `projects.procurement_items jsonb` — lista de materiale (BomItem[]) calculată în Studio la salvare:
--   { id, cat, procCategory, titleRo, titleEn, specRo, specEn, qty, unit, unitPrice, total, query, links[] }.
--   Arhiva (/account, /login) o afișează direct, fără redeschiderea Studio-ului.
--
-- COMPATIBILITATE:
--   • Coloana este opțională (NULL pentru proiectele vechi). API-ul .NET recalculează lista determinist
--     din mode / space_type / style_id / dimensions când lipsește, iar POST /api/projects/{id}/procurement
--     o salvează retroactiv (backfill).
--   • Linkurile către magazine NU sunt preluate orbește din JSON: serverul le reconstruiește din `query`
--     (doar Dedeman / IKEA / Leroy Merlin / Hornbach), deci un rând editat manual nu poate injecta URL-uri.
--   • Portalul public (/p/[id]) citește coloana doar pe server; prețurile interne nu apar niciodată în
--     răspunsul public (vezi PublicProjection.Pricing).
-- ════════════════════════════════════════════════════════════════════════════════

begin;

alter table public.projects
  add column if not exists procurement_items jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.projects'::regclass and conname = 'projects_procurement_items_array') then
    alter table public.projects
      add constraint projects_procurement_items_array
      check (procurement_items is null or jsonb_typeof(procurement_items) = 'array');
  end if;
end $$;

comment on column public.projects.procurement_items is
  'BomItem[] din Studio (materiale, cantități, prețuri orientative, interogări pentru magazine). NULL = se recalculează.';

commit;

notify pgrst, 'reload schema';

-- ── Verificare ──────────────────────────────────────────────────────────────────
select 'projects.procurement_items' as coloana, exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'projects' and column_name = 'procurement_items') as ok;
