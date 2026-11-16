// app/lib/b2b/estimate.ts
// B2B estimator: domain data, types and pure helpers (no React).
// Every amount here (rates, line prices, totals) is stored in EUR; the UI shows lei via `lei()` / `toRon()`.
import { fromRon, toRon } from '@/app/lib/format';


export type TradeId = 'finishes' | 'electrical' | 'drywall' | 'plumbing';
export type RegionId = 'paris' | 'petite-couronne' | 'grande-couronne' | 'bucharest' | 'west' | 'center' | 'southeast';

/** Piața implicită: București – Ilfov. */
export const DEFAULT_REGION: RegionId = 'bucharest';

// ── TVA (România) ────────────────────────────────────────────────────────────
// 21 % = cota standard (din 1 aug. 2025); 11 % = cota redusă (ex. livrarea de locuințe, anumite servicii).
// Orice altă cotă a firmei (0–100 %) rămâne introductibilă manual.
export const DEFAULT_VAT = 21;
export const REDUCED_VAT = 11;
export const VAT_PRESETS: { pct: number; ro: string; en: string; fr: string; hintRo: string; hintEn: string; hintFr: string }[] = [
  { pct: 21, ro: 'TVA 21%', en: 'VAT 21%', fr: 'TVA 21 %', hintRo: 'Cota standard', hintEn: 'Standard rate', hintFr: 'Taux normal' },
  { pct: 11, ro: 'TVA 11%', en: 'VAT 11%', fr: 'TVA 11 %', hintRo: 'Cota redusă', hintEn: 'Reduced rate', hintFr: 'Taux réduit' },
];

export const TRADES: { id: TradeId; ro: string; en: string; hoursPerM2: number }[] = [
  { id: 'finishes', ro: 'Finisaje', en: 'Finishes', hoursPerM2: 1.2 },
  { id: 'electrical', ro: 'Electrice', en: 'Electrical', hoursPerM2: 0.6 },
  { id: 'drywall', ro: 'Gips-carton', en: 'Drywall', hoursPerM2: 0.9 },
  { id: 'plumbing', ro: 'Sanitare', en: 'Plumbing', hoursPerM2: 0.5 },
];

// Illustrative starting rates (stored in €/h excl. VAT, shown in lei/h). Every rate is editable in the UI,
// so treat these as defaults to be replaced by your own price book.
// Regiunile românești sunt primele; zonele pariziene rămân la final pentru devizele deja salvate.
export const REGIONS: { id: RegionId; ro: string; en: string; fr?: string; rates: Record<TradeId, number> }[] = [
  { id: 'bucharest', ro: 'București – Ilfov', en: 'Bucharest – Ilfov', rates: { finishes: 9, electrical: 12, drywall: 8.5, plumbing: 11 } },
  { id: 'west', ro: 'Vest (Cluj, Timișoara)', en: 'West (Cluj, Timișoara)', rates: { finishes: 8.5, electrical: 11, drywall: 8, plumbing: 10.5 } },
  { id: 'center', ro: 'Centru / Nord (Brașov, Iași, Suceava)', en: 'Center / North (Brașov, Iași, Suceava)', rates: { finishes: 6.5, electrical: 8.5, drywall: 6, plumbing: 8 } },
  { id: 'southeast', ro: 'Sud / Est', en: 'South / East', rates: { finishes: 6, electrical: 8, drywall: 5.5, plumbing: 7.5 } },
  { id: 'paris', ro: 'Paris intra-muros', en: 'Paris (inner city)', fr: 'Paris intra-muros', rates: { finishes: 48, electrical: 58, drywall: 45, plumbing: 60 } },
  { id: 'petite-couronne', ro: 'Petite couronne (92 · 93 · 94)', en: 'Inner suburbs (92 · 93 · 94)', fr: 'Petite couronne (92 · 93 · 94)', rates: { finishes: 44, electrical: 54, drywall: 42, plumbing: 55 } },
  { id: 'grande-couronne', ro: 'Grande couronne (77 · 78 · 91 · 95)', en: 'Outer suburbs (77 · 78 · 91 · 95)', fr: 'Grande couronne (77 · 78 · 91 · 95)', rates: { finishes: 40, electrical: 50, drywall: 38, plumbing: 50 } },
];

export const FINISH_LEVELS = [
  { id: 'standard', ro: 'Standard', en: 'Standard', k: 1 },
  { id: 'premium', ro: 'Premium', en: 'Premium', k: 1.25 },
  { id: 'bespoke', ro: 'La comandă', en: 'Bespoke', k: 1.5 },
];

export interface Category { id: string; ro: string; en: string }
export const CATEGORIES: Category[] = [
  { id: 'electric', ro: 'Instalații electrice', en: 'Electrical works' },
  { id: 'sanitary', ro: 'Instalații sanitare', en: 'Plumbing works' },
  { id: 'finishes', ro: 'Finisaje', en: 'Finishes' },
  { id: 'structure', ro: 'Structură & gips-carton', en: 'Structure & drywall' },
  { id: 'other', ro: 'Altele', en: 'Other' },
];

export interface Template { cat: string; ro: string; en: string; unit: string; qty: number }
export const TEMPLATES: Template[] = [
  { cat: 'electric', ro: 'Priză dublă 16A', en: 'Double socket 16A', unit: 'buc.', qty: 10 },
  { cat: 'electric', ro: 'Întrerupător simplu 10A', en: 'Single switch 10A', unit: 'buc.', qty: 6 },
  { cat: 'electric', ro: 'Cablu NYM-J 3×2.5 mm²', en: 'Cable NYM-J 3×2.5 mm²', unit: 'ml', qty: 80 },
  { cat: 'electric', ro: 'Tablou electric echipat', en: 'Equipped consumer unit', unit: 'buc.', qty: 1 },
  { cat: 'electric', ro: 'Spot LED încastrat 9W', en: 'Recessed LED spot 9W', unit: 'buc.', qty: 8 },
  { cat: 'sanitary', ro: 'Punct apă rece/caldă', en: 'Water connection point', unit: 'punct', qty: 4 },
  { cat: 'sanitary', ro: 'Țeavă PPR Ø20 mm', en: 'PPR pipe Ø20 mm', unit: 'ml', qty: 25 },
  { cat: 'sanitary', ro: 'Vas WC suspendat + rezervor încastrat', en: 'Wall-hung WC + concealed cistern', unit: 'buc.', qty: 1 },
  { cat: 'finishes', ro: 'Montaj parchet triplustratificat', en: 'Engineered parquet installation', unit: 'm²', qty: 20 },
  { cat: 'finishes', ro: 'Vopsit pereți (2 straturi + grund)', en: 'Wall painting (2 coats + primer)', unit: 'm²', qty: 60 },
  { cat: 'finishes', ro: 'Placare gresie / faianță', en: 'Floor/wall tiling', unit: 'm²', qty: 15 },
  { cat: 'structure', ro: 'Tavan suspendat gips-carton', en: 'Suspended GK ceiling', unit: 'm²', qty: 20 },
  { cat: 'structure', ro: 'Perete gips-carton simplu', en: 'Single-layer GK partition', unit: 'm²', qty: 12 },
  { cat: 'structure', ro: 'Șapă autonivelantă 40 mm', en: 'Self-levelling screed 40 mm', unit: 'm²', qty: 20 },
];

export interface LineItem {
  id: string;
  cat: string;
  ro: string;
  en: string;
  unit: string;
  qty: number;
  price: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Deterministic money format (no Intl → identical on server and client): EUR amount shown in lei, ro-RO style. */
export const lei = (n: number) => {
  const [i, d] = toRon(n).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} lei`;
};
/** Value of a money input shown in lei (stored amount is EUR). */
export const ronInput = (eurValue: number) => toRon(eurValue);
/** Parses a lei input back to the stored EUR amount (clamped ≥ 0). */
export const eurFromRonInput = (v: string) => fromRon(clampNum(v));
export const clampNum = (v: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
export const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const unitCode = (u: string) => (u === 'm²' ? 'MTK' : u === 'ml' ? 'MTR' : u === 'h' ? 'HUR' : 'C62');

let uidCounter = 0; // only called from event handlers, never during render
export const uid = () => `l${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export function download(filename: string, content: string, mime: string, bom = false) {
  const blob = new Blob([bom ? '\uFEFF' + content : content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `section` = titlul secțiunii din deviz (Manoperă, Finisaje, o secțiune personalizată…), pentru grupare în exporturi. */
export interface InvoiceLine { name: string; unit: string; qty: number; unitPrice: number; total: number; section?: string }

// ═════════════════════════════════════════════════════════════════════════════
// Secțiuni de deviz (implicite + personalizate)
// ═════════════════════════════════════════════════════════════════════════════
// Ordinea din `sections` = ordinea cardurilor în editor, în PDF și în exporturi. O secțiune implicită
// eliminată (lipsește din listă) poate fi restaurată dintr-un click; liniile ei sunt șterse la eliminare,
// deci totalurile o exclud imediat. Liniile cu `cat` necunoscut primesc automat o secțiune (date vechi).

export interface EstimateSection {
  id: string;
  ro: string;
  en: string;
  /** Creată de utilizator: titlu editabil, nu apare în bara de restaurare. */
  custom?: boolean;
}

/** Sugestii rapide pentru „+ Secțiune nouă" (sau orice text liber). */
export const SECTION_PRESETS: { ro: string; en: string; fr: string }[] = [
  { ro: 'Instalații sanitare', en: 'Plumbing works', fr: 'Plomberie' },
  { ro: 'Instalații electrice', en: 'Electrical works', fr: 'Électricité' },
  { ro: 'Tâmplărie & Ferestre', en: 'Joinery & Windows', fr: 'Menuiserie & Fenêtres' },
  { ro: 'Amenajări exterioare', en: 'Outdoor landscaping', fr: 'Aménagements extérieurs' },
];

const toSection = (c: Category): EstimateSection => ({ id: c.id, ro: c.ro, en: c.en });
export const defaultSections = (): EstimateSection[] => CATEGORIES.map(toSection);
const defaultIndex = (id: string) => CATEGORIES.findIndex((c) => c.id === id);

/** Inserează o secțiune: cele implicite își reiau locul din `CATEGORIES`, cele personalizate merg la final. */
export function insertSection(sections: EstimateSection[], sec: EstimateSection): EstimateSection[] {
  if (sections.some((s) => s.id === sec.id)) return sections;
  const di = defaultIndex(sec.id);
  if (di < 0) return [...sections, sec];
  const at = sections.findIndex((s) => defaultIndex(s.id) > di); // înaintea primei secțiuni implicite de după ea
  return at < 0 ? [...sections, sec] : [...sections.slice(0, at), sec, ...sections.slice(at)];
}

/** Garantează o secțiune pentru fiecare `cat` folosit de linii (implicită dacă e cunoscută, altfel personalizată). */
export function withSectionsFor(sections: EstimateSection[], items: LineItem[]): EstimateSection[] {
  let out = sections;
  for (const i of items) {
    if (out.some((s) => s.id === i.cat)) continue;
    const def = CATEGORIES.find((c) => c.id === i.cat);
    out = insertSection(out, def ? toSection(def) : { id: i.cat, ro: i.cat || 'Altele', en: i.cat || 'Other', custom: true });
  }
  return out;
}

/** Secțiunile unui deviz salvat; devizele vechi (fără `sections`) pornesc de la toate secțiunile implicite. */
export function normalizeSections(sections: EstimateSection[] | undefined, items: LineItem[]): EstimateSection[] {
  const base = Array.isArray(sections)
    ? sections.filter((s) => s && typeof s.id === 'string' && s.id).map((s) => ({ ...s, ro: s.ro ?? '', en: s.en ?? '' }))
    : defaultSections();
  return withSectionsFor(base, items);
}

/** Secțiunile implicite eliminate, în ordinea lor standard (pentru bara de restaurare). */
export const removedDefaultSections = (sections: EstimateSection[]): Category[] =>
  CATEGORIES.filter((c) => !sections.some((s) => s.id === c.id));

/** Liniile implicite ale unei secțiuni standard (din șabloane, preț 0 de completat). */
export const defaultItemsFor = (catId: string): LineItem[] =>
  TEMPLATES.filter((t) => t.cat === catId).map((t) => ({ id: uid(), cat: t.cat, ro: t.ro, en: t.en, unit: t.unit, qty: t.qty, price: 0 }));

/** Doar liniile care aparțin unei secțiuni active (contează în totaluri, PDF și exporturi). */
export const activeItems = (items: LineItem[], sections: EstimateSection[]): LineItem[] => {
  const ids = new Set(sections.map((s) => s.id));
  return items.filter((i) => ids.has(i.cat));
};

export const newSectionId = () => `s${uid().slice(1)}`;

// ── Persistență în cloud ─────────────────────────────────────────────────────
// API-ul (`b2b_estimates.line_items`, jsonb) nu are câmp pentru secțiuni, așa că structura devizului
// călătorește în aceeași listă, ca linii-marcaj cu `qty = 0`: portalul public și prețurile clientului
// ignoră liniile fără cantitate, iar `decodeLayout` le scoate înapoi la încărcare.
const SECTION_META = '__section';
const LABOR_META = '__labor';

export function encodeLayout(items: LineItem[], sections: EstimateSection[], laborOff: boolean): LineItem[] {
  const meta: LineItem[] = sections.map((s) => ({
    id: `§${s.id}`.slice(0, 40), cat: SECTION_META, ro: s.ro.slice(0, 200), en: s.en.slice(0, 200), unit: s.custom ? 'custom' : '', qty: 0, price: 0,
  }));
  meta.push({ id: '§labor', cat: LABOR_META, ro: '', en: '', unit: laborOff ? 'off' : 'on', qty: 0, price: 0 });
  return [...meta, ...items];
}

/** Inversul lui `encodeLayout`. `sections` lipsește pentru devizele salvate înainte de secțiuni. */
export function decodeLayout(lines: LineItem[]): { items: LineItem[]; sections?: EstimateSection[]; laborOff: boolean } {
  const sections: EstimateSection[] = [];
  let laborOff = false;
  let hasLayout = false;
  const items: LineItem[] = [];
  for (const l of lines ?? []) {
    if (l.cat === SECTION_META) {
      hasLayout = true;
      sections.push({ id: l.id.replace(/^§/, ''), ro: l.ro, en: l.en, ...(l.unit === 'custom' ? { custom: true } : {}) });
    } else if (l.cat === LABOR_META) {
      hasLayout = true;
      laborOff = l.unit === 'off';
    } else items.push(l);
  }
  return { items, sections: hasLayout ? sections : undefined, laborOff };
}
