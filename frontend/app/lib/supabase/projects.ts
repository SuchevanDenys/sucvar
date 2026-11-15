// app/lib/supabase/projects.ts
// Proiecte salvate: Cloud (tabelul `projects`) cu rezervă locală (localStorage).
import type { BomItem } from '@/app/lib/procurement';
import { sanitizeDimensions } from '@/app/lib/studio/validation';
import { parseBrief } from '@/app/lib/studio/vision';
import type {
  DeleteProjectResult,
  DesignMode,
  ProjectRow,
  RoomDimensions,
  SavedProject,
  SaveProjectResult,
} from '@/app/types';
import { STORAGE_KEYS } from '@/app/lib/storage';
import { getSessionEmail } from './auth';
import { supabase } from './client';
import { explainDbError, getErrorMessage } from './errors';

// ── localStorage helpers ──────────────────────────────────────────────────────

// Citește lista de proiecte salvate local (un JSON invalid este ignorat, nu blochează aplicația)
function readLocalProjects(): SavedProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.projects);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Ignorăm intrările stricate și normalizăm cotele (date vechi sau editate manual)
    return (parsed as SavedProject[])
      .filter((p) => p && typeof p === 'object' && typeof p.id === 'string')
      .map((p) => ({
        ...p,
        title: String(p.title ?? '').trim() || 'Proiect SUCVAR',
        createdAt: String(p.createdAt ?? new Date().toISOString()),
        dimensions: sanitizeDimensions(p.dimensions, p.mode, p.spaceType),
      }));
  } catch {
    return [];
  }
}

// Scrie lista local. Imaginile Base64 sunt mari, iar localStorage are ~5 MB, deci:
//  1) încercăm lista completă;
//  2) dacă nu încape, scoatem fotografiile originale ale proiectelor mai vechi
//     (proiectul curent `keepId` rămâne întreg);
//  3) ultima variantă: scoatem toate fotografiile originale.
// Întoarce false doar dacă nimic nu a putut fi scris.
function writeLocalProjects(projects: SavedProject[], keepId?: string): boolean {
  if (typeof window === 'undefined') return false;
  const attempts: SavedProject[][] = [
    projects,
    projects.map((p) => (p.id === keepId ? p : { ...p, originalImage: null })),
    projects.map((p) => ({ ...p, originalImage: null })),
  ];
  for (const attempt of attempts) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(attempt));
      return true;
    } catch {
      // memorie plină: trecem la varianta mai compactă
    }
  }
  return false;
}

// ── Mapare sigură SavedProject ↔ rând Supabase ────────────────────────────────

// Cotele din Supabase pot fi JSON sau text; le curățăm și le limităm la valori valide
function parseDimensions(raw: unknown, mode: DesignMode, spaceType: string): RoomDimensions {
  return sanitizeDimensions(raw, mode, spaceType);
}

function toRow(p: SavedProject, ownerEmail: string): ProjectRow {
  return {
    id: p.id,
    user_email: ownerEmail.toLowerCase(),
    title: p.title,
    mode: p.mode,
    space_type: p.spaceType,
    style_id: p.styleId,
    // Brief-ul Studio stă lângă cote în același jsonb: Arhiva și portalul /p/[id] îl citesc de acolo
    dimensions: p.brief ? { ...p.dimensions, brief: p.brief } : p.dimensions,
    original_image: p.originalImage,
    generated_image: p.generatedImage,
    total_budget: p.totalBudget,
    created_at: p.createdAt,
    procurement_items: p.procurementItems ?? null,
  };
}

// Coloana `procurement_items` vine din migrarea 006; până la rularea ei PostgREST răspunde
// „Could not find the 'procurement_items' column" (PGRST204) / 42703 — atunci reîncercăm fără ea.
function isMissingProcurementColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return /procurement_items/i.test(error.message ?? '') || error.code === 'PGRST204' || error.code === '42703';
}

// Lista salvată (JSON din baza de date) → BomItem[]; orice formă invalidă este ignorată.
function parseProcurement(raw: unknown): BomItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(
    (i): i is BomItem =>
      !!i && typeof i === 'object' && typeof (i as BomItem).titleRo === 'string' && Array.isArray((i as BomItem).links),
  );
}

// Transformă un rând din Supabase într-un proiect valid (valorile lipsă primesc implicite)
function fromRow(row: ProjectRow): SavedProject {
  const mode: DesignMode =
    row.mode === 'exteriors' || row.mode === 'gardens' || row.mode === 'interiors'
      ? row.mode
      : 'interiors';
  const spaceType = String(row.space_type ?? 'kitchen');
  return {
    id: String(row.id),
    userEmail: String(row.user_email ?? '').toLowerCase(),
    title: String(row.title ?? '').trim() || 'Proiect SUCVAR',
    mode,
    spaceType,
    styleId: String(row.style_id ?? 'scandinavian'),
    dimensions: parseDimensions(row.dimensions, mode, spaceType),
    originalImage: row.original_image ?? null,
    generatedImage: row.generated_image ?? null,
    totalBudget: Number(row.total_budget) || 0,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    procurementItems: parseProcurement(row.procurement_items),
    brief: parseBrief(row.dimensions) ?? undefined,
  };
}

// ── Baza de date: proiecte ────────────────────────────────────────────────────

// Salvează proiectul: mai întâi local (instant, funcționează și offline), apoi în
// Supabase (tabelul `projects`, imaginile Base64 se păstrează în coloanele text).
export async function saveProjectToDb(project: SavedProject): Promise<SaveProjectResult> {
  // 1. Salvare locală imediată în browser
  const others = readLocalProjects().filter((p) => p.id !== project.id);
  const savedLocally = writeLocalProjects([project, ...others], project.id);

  if (!supabase) {
    return {
      savedToCloud: false,
      savedLocally,
      errorMessage: 'Supabase nu este configurat (variabile .env lipsă).',
    };
  }

  const sessionEmail = await getSessionEmail();
  const ownerEmail = (sessionEmail ?? project.userEmail).trim().toLowerCase();

  try {
    const row = toRow(project, ownerEmail);
    let { error } = await supabase.from('projects').upsert(row, { onConflict: 'id' });
    if (isMissingProcurementColumn(error)) {
      // Bază nemigrată (006): salvăm proiectul fără listă; Arhiva o recalculează pe server.
      const { procurement_items: _omit, ...legacy } = row;
      void _omit;
      ({ error } = await supabase.from('projects').upsert(legacy, { onConflict: 'id' }));
    }

    if (error) {
      console.error('[SUCVAR] Supabase upsert error:', error);
      return {
        savedToCloud: false,
        savedLocally,
        errorMessage: explainDbError(error.message, sessionEmail !== null),
      };
    }
    return { savedToCloud: true, savedLocally };
  } catch (err) {
    console.error('[SUCVAR] Supabase upsert exception:', err);
    return { savedToCloud: false, savedLocally, errorMessage: getErrorMessage(err) };
  }
}

// Șterge proiectul. Întâi din Cloud: dacă acolo ștergerea eșuează, proiectul rămâne
// și local, ca să nu „reapară" la următoarea sincronizare fără ca utilizatorul să știe.
export async function deleteProjectFromDb(projectId: string): Promise<DeleteProjectResult> {
  if (supabase) {
    try {
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (error) {
        console.error('[SUCVAR] Supabase delete error:', error);
        return { ok: false, errorMessage: error.message };
      }
    } catch (err) {
      console.error('[SUCVAR] Supabase delete exception:', err);
      return { ok: false, errorMessage: getErrorMessage(err) };
    }
  }

  writeLocalProjects(readLocalProjects().filter((p) => p.id !== projectId));
  return { ok: true };
}

// Încarcă arhiva utilizatorului: Cloud + local, fără dubluri, cele mai noi primele.
export async function fetchProjectsFromDb(userEmail: string): Promise<SavedProject[]> {
  const cleanEmail = userEmail.trim().toLowerCase();

  const localProjects = readLocalProjects().filter(
    (p) => !p.userEmail || p.userEmail.toLowerCase() === cleanEmail,
  );

  if (!supabase) return localProjects;

  try {
    const baseColumns =
      'id, user_email, title, mode, space_type, style_id, dimensions, original_image, generated_image, total_budget, created_at';
    const select = (columns: string) =>
      supabase!.from('projects').select(columns).ilike('user_email', cleanEmail).order('created_at', { ascending: false });
    let { data, error } = await select(`${baseColumns}, procurement_items`);
    if (isMissingProcurementColumn(error)) ({ data, error } = await select(baseColumns));

    if (error) {
      console.error('[SUCVAR] Supabase select error:', error);
      return localProjects;
    }

    const cloudProjects = ((data ?? []) as unknown as ProjectRow[]).map(fromRow);

    // Combinăm proiectele din Cloud cu cele locale (și dacă un proiect din Cloud are imaginea goală, o luăm din local)
    const localMap = new Map(localProjects.map((lp) => [lp.id, lp]));
    const enrichedCloud = cloudProjects.map((cp) => {
      const localMatch = localMap.get(cp.id);
      return {
        ...cp,
        generatedImage: cp.generatedImage || localMatch?.generatedImage || null,
        originalImage: cp.originalImage || localMatch?.originalImage || null,
        procurementItems: cp.procurementItems ?? localMatch?.procurementItems,
        brief: cp.brief ?? localMatch?.brief,
      };
    });

    const cloudIds = new Set(enrichedCloud.map((p) => p.id));
    const merged = [
      ...enrichedCloud,
      ...localProjects.filter((p) => !cloudIds.has(p.id)),
    ];
    merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return merged;
  } catch (err) {
    console.error('[SUCVAR] Supabase select exception:', err);
    return localProjects;
  }
}

// Numărul de proiecte create de utilizator de la începutul lunii calendaristice curente
// (maximul dintre Cloud și memoria locală a browserului).
export async function countProjectsThisMonth(userEmail: string): Promise<number> {
  const cleanEmail = userEmail.trim().toLowerCase();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const localCount = readLocalProjects().filter(
    (p) =>
      (!p.userEmail || p.userEmail.toLowerCase() === cleanEmail) && p.createdAt >= monthStart,
  ).length;

  if (!supabase) return localCount;

  try {
    const { count, error } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .ilike('user_email', cleanEmail)
      .gte('created_at', monthStart);

    if (error) {
      console.error('[SUCVAR] Supabase count error:', error);
      return localCount;
    }
    return Math.max(localCount, count ?? 0);
  } catch (err) {
    console.error('[SUCVAR] Supabase count exception:', err);
    return localCount;
  }
}

// Găsește un singur proiect după id (folosit la „Deschide în Studio", ca să nu mai
// punem imagini Base64 de câțiva MB în localStorage doar pentru a le transmite între pagini).
export async function getProjectById(userEmail: string, projectId: string): Promise<SavedProject | null> {
  const projects = await fetchProjectsFromDb(userEmail);
  return projects.find((p) => p.id === projectId) ?? null;
}
