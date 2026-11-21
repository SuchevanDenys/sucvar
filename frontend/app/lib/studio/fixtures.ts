// app/lib/studio/fixtures.ts
// „Repere MEP & colțuri”: elementele structurale și instalațiile detectate de modelul vizual (etapa 1 a pipeline-ului de
// precizie din /api/generate, câmpul `detectedFixtures`) — prize, întrerupătoare, calorifere, uși, ferestre, colțuri.
// Validare defensivă (date din API) + etichete și culori pentru suprapunerea opțională din StudioViewport.
// Modul pur (fără importuri `@/`), testat cu Node.

export type FixtureKind = 'outlet' | 'switch' | 'radiator' | 'door' | 'window' | 'corner';

export interface DetectedFixture {
  kind: FixtureKind;
  /** Cutia normalizată 0..1 (originea stânga-sus, cadrul fotografiei sursă). */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  /** Pixelii originali au fost restaurați peste element după generare (scutul MEP). */
  shielded: boolean;
}

const KINDS = new Set<FixtureKind>(['outlet', 'switch', 'radiator', 'door', 'window', 'corner']);
/** Instalațiile (Bordeaux); golurile și colțurile structurale sunt Champagne. */
const MEP = new Set<FixtureKind>(['outlet', 'switch', 'radiator']);
const MAX_FIXTURES = 32;

export const FIXTURE_COLORS = { mep: '#5C1628', structure: '#A67C52' } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const isMepFixture = (kind: FixtureKind) => MEP.has(kind);
export const fixtureColor = (kind: FixtureKind) => (MEP.has(kind) ? FIXTURE_COLORS.mep : FIXTURE_COLORS.structure);

/** Orice formă invalidă este ignorată; întoarce `[]` când nu rămâne niciun element. */
export function parseDetectedFixtures(raw: unknown): DetectedFixture[] {
  if (!Array.isArray(raw)) return [];
  const out: DetectedFixture[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || out.length >= MAX_FIXTURES) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !KINDS.has(o.kind as FixtureKind)) continue;
    const [x, y, width, height, confidence] = [o.x, o.y, o.width, o.height, o.confidence].map(Number);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const x0 = clamp01(x);
    const y0 = clamp01(y);
    const w = Math.min(width, 1 - x0);
    const h = Math.min(height, 1 - y0);
    if (w <= 0 || h <= 0) continue;
    out.push({
      kind: o.kind as FixtureKind,
      x: x0, y: y0, width: w, height: h,
      confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0.5,
      shielded: o.shielded === true,
    });
  }
  return out;
}

/** Eticheta scurtă a unui element (RO · EN · FR). */
export function fixtureLabel(kind: FixtureKind, lang: string): string {
  const labels: Record<FixtureKind, [string, string, string]> = {
    outlet: ['Priză', 'Outlet', 'Prise'],
    switch: ['Întrerupător', 'Switch', 'Interrupteur'],
    radiator: ['Calorifer', 'Radiator', 'Radiateur'],
    door: ['Ușă', 'Door', 'Porte'],
    window: ['Fereastră', 'Window', 'Fenêtre'],
    corner: ['Colț', 'Corner', 'Angle'],
  };
  const [ro, en, fr] = labels[kind];
  return lang === 'en' ? en : lang === 'fr' ? fr : ro;
}

/** „3 instalații · 2 goluri · 1 colț” — rezumatul pentru titlul comutatorului. */
export function fixtureSummary(fixtures: readonly DetectedFixture[]): { mep: number; openings: number; corners: number; shielded: number } {
  return {
    mep: fixtures.filter((f) => MEP.has(f.kind)).length,
    openings: fixtures.filter((f) => f.kind === 'door' || f.kind === 'window').length,
    corners: fixtures.filter((f) => f.kind === 'corner').length,
    shielded: fixtures.filter((f) => f.shielded).length,
  };
}
