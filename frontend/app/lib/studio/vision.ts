// app/lib/studio/vision.ts
// Studio „Descrie ce îți dorești”: tipuri, inspirații dintr-un click și opțiunile (opționale) de paletă / lumină.
// Sursa de adevăr pentru prompt și pentru materialele recunoscute este API-ul (Sucvar.Domain.Ai.DesignVision);
// aici păstrăm doar o oglindă mică a detectării stilului / camerei, folosită pentru previzualizarea costului
// înainte de generare.
import type { DesignMode, Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

export const CUSTOM_PROMPT_MAX = 1000;
export const AUTO = 'auto' as const;

export type PaletteId = 'warm_neutral' | 'monochrome' | 'earthy' | 'cool_grey' | 'dark_moody' | 'light_airy';
export type LightingId = 'natural' | 'golden_hour' | 'evening' | 'studio' | 'dramatic';

export interface VisionPill<Id extends string> {
  id: Id;
  ro: string;
  en: string;
}

export const PALETTES: VisionPill<PaletteId>[] = [
  { id: 'warm_neutral', ro: 'Neutru cald', en: 'Warm neutral' },
  { id: 'monochrome', ro: 'Monocrom', en: 'Monochrome' },
  { id: 'earthy', ro: 'Pământiu', en: 'Earthy' },
  { id: 'cool_grey', ro: 'Gri rece', en: 'Cool grey' },
  { id: 'dark_moody', ro: 'Întunecat', en: 'Dark & moody' },
  { id: 'light_airy', ro: 'Luminos', en: 'Light & airy' },
];

export const LIGHTINGS: VisionPill<LightingId>[] = [
  { id: 'natural', ro: 'Lumină naturală', en: 'Natural daylight' },
  { id: 'golden_hour', ro: 'Apus cald', en: 'Golden hour' },
  { id: 'evening', ro: 'Seară ambientală', en: 'Evening ambient' },
  { id: 'studio', ro: 'Studio luminos', en: 'Bright studio' },
  { id: 'dramatic', ro: 'Dramatic', en: 'Dramatic' },
];

/** Inspirații arhitecturale: un click completează (sau rafinează) descrierea. */
export interface InspirationPreset {
  id: string;
  labelRo: string;
  labelEn: string;
  promptRo: string;
  promptEn: string;
  /** Français explicite (sinon : dictionnaire FR indexé par promptEn / labelEn) */
  labelFr?: string;
  promptFr?: string;
  /** Preset parisien reconnu par l’API (DesignVision.Presets) : style de base + enrichissement du prompt */
  parisian?: boolean;
}

export const INSPIRATIONS: InspirationPreset[] = [
  // ── Presets parisiens (marché Paris & Île-de-France) ── mots-clés détectés côté API dans les 3 langues
  {
    id: 'haussmannien',
    parisian: true,
    labelFr: 'Haussmannien contemporain',
    labelEn: 'Contemporary Haussmannian',
    labelRo: 'Haussmannian contemporan',
    promptFr: 'Appartement haussmannien contemporain, moulures et corniches au plafond, parquet chêne Point de Hongrie, hautes fenêtres à la française, cheminée en marbre blanc et mobilier contemporain',
    promptEn: 'Contemporary Haussmannian apartment, ceiling moulures and cornices, oak Point de Hongrie parquet, tall French windows, white marble fireplace and contemporary furniture',
    promptRo: 'Apartament haussmannian contemporan, moulures și corniche pe tavan, parchet stejar Point de Hongrie, ferestre franțuzești înalte, șemineu din marmură albă și mobilier contemporan',
  },
  {
    id: 'atelier-parisien',
    parisian: true,
    labelFr: 'Atelier parisien',
    labelEn: 'Parisian atelier',
    labelRo: 'Atelier parizian',
    promptFr: 'Atelier parisien, verrière noire en acier, murs en briques apparentes, parquet et mobilier en chêne massif, grandes fenêtres d’atelier et suspensions chaleureuses',
    promptEn: 'Atelier parisien loft, black steel verrière glass partition, exposed brick walls, solid oak flooring and furniture, tall factory windows and warm pendant lights',
    promptRo: 'Atelier parizian, verrière neagră din oțel, pereți din cărămidă aparentă, parchet și mobilier din stejar masiv, ferestre înalte de atelier și lustre suspendate calde',
  },
  {
    id: 'rive-gauche',
    parisian: true,
    labelFr: 'Rive Gauche épuré',
    labelEn: 'Refined Rive Gauche',
    labelRo: 'Rive Gauche epurat',
    promptFr: 'Appartement Rive Gauche épuré, murs en pierre de Paris, lin naturel, chêne clair, touches de travertin et lumière douce du jour — un luxe discret',
    promptEn: 'Refined Rive Gauche apartment, Pierre de Paris limestone walls, natural linen, pale oak, travertine accents and soft daylight — quiet luxury',
    promptRo: 'Apartament Rive Gauche epurat, pereți din piatră de Paris (pierre de Paris), in natural, stejar deschis, accente de travertin și lumină naturală blândă',
  },
  {
    id: 'scandi-oak',
    labelRo: 'Scandinav cald & stejar',
    labelEn: 'Warm Scandi & oak',
    promptRo: 'Stil scandinav cald, parchet de stejar, canapea din in crem, pereți albi, lumină naturală și plante',
    promptEn: 'Warm Scandinavian style, oak flooring, cream linen sofa, white walls, natural light and plants',
  },
  {
    id: 'mono-minimal',
    labelRo: 'Minimalist monocrom',
    labelEn: 'Monochrome minimalist',
    promptRo: 'Minimalist monocrom, microciment gri, pereți albi, accente negre mate și bandă LED ascunsă',
    promptEn: 'Monochrome minimalist, grey microcement, white walls, matte black accents and hidden LED strip',
  },
  {
    id: 'industrial',
    labelRo: 'Modern industrial',
    labelEn: 'Modern industrial',
    promptRo: 'Loft industrial modern, cărămidă aparentă, canapea din piele, accente negre mate și lustră suspendată',
    promptEn: 'Modern industrial loft, exposed brick wall, leather sofa, matte black accents and pendant lights',
  },
  {
    id: 'japandi',
    labelRo: 'Japandi liniștit',
    labelEn: 'Calm Japandi',
    promptRo: 'Japandi liniștit, lemn natural, riflaje de lemn, covor din lână, lumină caldă și draperii din in',
    promptEn: 'Calm Japandi, natural wood, wood slat panels, wool rug, warm light and linen curtains',
  },
  {
    id: 'parisian',
    labelRo: 'Clasic parizian',
    labelEn: 'Parisian classic',
    promptRo: 'Apartament parizian clasic, parchet în spic, marmură, accesorii din alamă și canapea din catifea',
    promptEn: 'Classic Parisian apartment, herringbone parquet, marble, brass details and velvet sofa',
  },
  {
    id: 'biophilic',
    labelRo: 'Biofil & travertin',
    labelEn: 'Biophilic & travertine',
    promptRo: 'Interior biofil, travertin, multe plante, mobilier din ratan și lumină naturală',
    promptEn: 'Biophilic interior, travertine, lots of plants, rattan furniture and natural light',
  },
];

/** Adaugă textul unei inspirații: înlocuiește un câmp gol, altfel îl completează (fără dubluri). */
export function applyInspiration(current: string, preset: InspirationPreset, lang: Language): string {
  const addition = tr(lang, preset.promptRo, preset.promptEn, preset.promptFr);
  const trimmed = current.trim();
  if (!trimmed) return addition;
  if (trimmed.includes(addition)) return trimmed;
  return `${trimmed.replace(/[.,;\s]+$/, '')}, ${addition.charAt(0).toLowerCase()}${addition.slice(1)}`.slice(0, CUSTOM_PROMPT_MAX);
}

/** Ce a fost salvat împreună cu proiectul (dimensions.brief în Supabase) — apare în Arhivă și în portalul /p/[id]. */
export interface DesignBriefMeta {
  customPrompt: string;
  preserveStructure: boolean;
  palette: PaletteId | null;
  lighting: LightingId | null;
  /** true = stilul a fost dedus automat din descriere */
  styleAuto: boolean;
}

export interface VisionMaterialSummary {
  id: string;
  slot: string;
  titleRo: string;
  titleEn: string;
}

/** `vision` din răspunsul POST /api/generate (brief-ul rezolvat de server). */
export interface VisionResponse {
  customPrompt: string;
  styleId: string | null;
  styleInferred: boolean;
  palette: PaletteId | null;
  lighting: LightingId | null;
  spaceType: string;
  spaceInferred: boolean;
  areaSqm: number;
  preserveStructure: boolean;
  materials: VisionMaterialSummary[];
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .trim();

// Potrivire ca pe server: cuvintele de 5+ litere se potrivesc și ca prefix („scandinav” → „scandinavă”).
function matches(text: string, keyword: string): boolean {
  const k = normalize(keyword);
  return k.length >= 5 ? ` ${text}`.includes(` ${k}`) : ` ${text} `.includes(` ${k} `);
}

const STYLE_KEYWORDS: [string, string[]][] = [
  ['minimalist_obsidian', ['obsidian', 'monocrom negru', 'all black', 'total black']],
  ['mid_century_modern', ['mid century', 'mid-century', 'retro anii 60', 'anii 50', 'anii 60']],
  ['brutalist_concrete', ['brutalist', 'brutal', 'beton aparent', 'exposed concrete']],
  ['japandi', ['japandi', 'japonez', 'japanese', 'wabi sabi', 'wabi-sabi']],
  ['scandinavian', ['scandinav', 'nordic', 'nordica', 'hygge']],
  ['industrial', ['industrial', 'loft']],
  ['biophilic', ['biofil', 'biophilic', 'organic', 'plin de plante', 'jungle']],
  ['coastal', ['coastal', 'mediteranean', 'mediterranean', 'marin', 'beach', 'plaja']],
  ['traditional', ['clasic', 'classic', 'parizian', 'parisian', 'neoclasic', 'neoclassic', 'traditional']],
  ['minimalist', ['minimalist', 'minimal', 'monocrom', 'monochrome']],
  ['contemporary', ['contemporan', 'contemporary']],
  ['modern', ['modern']],
];

const SPACE_KEYWORDS: [string, string[]][] = [
  ['walk-in closet', ['dressing', 'walk-in', 'walk in closet']],
  ['home office', ['birou', 'office', 'studiu']],
  ['master bedroom', ['dormitor', 'bedroom']],
  ['bathroom', ['baie', 'baia', 'bathroom']],
  ['kitchen', ['bucatari', 'kitchen']],
  ['entryway', ['hol', 'intrare', 'entryway', 'hallway']],
  ['attic loft', ['mansarda', 'attic']],
  ['commercial cafe', ['cafenea', 'cafe', 'restaurant', 'bistro']],
  ['living room', ['living', 'sufragerie', 'camera de zi', 'salon', 'lounge']],
];

/** Stilul dedus din descriere (oglinda lui DesignVision.InferStyle) sau null. */
export function inferStyleFromText(text: string): string | null {
  const n = normalize(text);
  if (!n) return null;
  return STYLE_KEYWORDS.find(([, keys]) => keys.some((k) => matches(n, k)))?.[0] ?? null;
}

/** Camera dedusă din descriere (doar interioare) sau null. */
export function inferSpaceFromText(mode: DesignMode, text: string): string | null {
  if (mode !== 'interiors') return null;
  const n = normalize(text);
  if (!n) return null;
  return SPACE_KEYWORDS.find(([, keys]) => keys.some((k) => matches(n, k)))?.[0] ?? null;
}

/** Citește brief-ul salvat în dimensions.brief (rânduri Supabase / proiecte locale); null dacă lipsește. */
export function parseBrief(raw: unknown): DesignBriefMeta | null {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object') return null;
  const b = (source as { brief?: unknown }).brief;
  if (!b || typeof b !== 'object') return null;
  const r = b as Record<string, unknown>;
  const customPrompt = typeof r.customPrompt === 'string' ? r.customPrompt.slice(0, CUSTOM_PROMPT_MAX) : '';
  return {
    customPrompt,
    preserveStructure: r.preserveStructure !== false,
    palette: PALETTES.some((p) => p.id === r.palette) ? (r.palette as PaletteId) : null,
    lighting: LIGHTINGS.some((p) => p.id === r.lighting) ? (r.lighting as LightingId) : null,
    styleAuto: r.styleAuto === true,
  };
}
