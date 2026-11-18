// app/lib/studio/perspective.ts
// „Calibrare din fotografie” — măsurarea camerei dintr-o singură imagine (geometrie proiectivă).
//
// Intrări (coordonate în pixeli ai imaginii):
//   • 4 colțuri ale podelei (dreptunghiul camerei, în ordine pe contur: A → B → C → D);
//   • o referință verticală de înălțime cunoscută (ex. ușă standard 2,10 m): baza pe podea + vârful;
//   • opțional, un punct pe tavan, vertical deasupra colțului A (pentru înălțimea camerei).
//
// Metoda:
//   1. Punctele de fugă ale laturilor opuse (AB ∩ DC, BC ∩ AD) dau direcțiile podelei; dacă sunt finite,
//      ortogonalitatea lor fixează distanța focală f (punct principal = centrul imaginii). Altfel: f ≈ 0,75 × latura
//      lungă a imaginii (camera principală de telefon, ~26 mm echivalent).
//   2. Normala podelei n = d1 × d2 (în coordonate cameră, K⁻¹v). Colțurile 3D = intersecția razelor cu planul n·X = 1.
//   3. Referința: punctul de pe verticala bazei (direcția −n) cel mai apropiat de raza vârfului ⇒ înălțimea ei în
//      unități arbitrare ⇒ factorul de scară metri / unitate. Laturile și înălțimea camerei se scalează cu el.
//
// Modul este PUR (fără importuri) — testat cu o cameră sintetică în `tests/perspective.test.ts`.

export interface Pt {
  x: number;
  y: number;
}

type V3 = [number, number, number];

export interface CalibrationInput {
  imageWidth: number;
  imageHeight: number;
  /** Colțurile podelei, în ordine pe contur (A, B, C, D). */
  floor: [Pt, Pt, Pt, Pt];
  refBottom: Pt;
  refTop: Pt;
  /** Înălțimea reală a referinței, în metri. */
  refHeightM: number;
  /** Punct pe tavan, vertical deasupra colțului A (opțional). */
  ceiling?: Pt | null;
  /** Distanța focală în pixeli, dacă e cunoscută (altfel: estimată). */
  focalPx?: number;
}

export type CalibrationError = 'degenerate' | 'behind-horizon' | 'reference-invalid';

export interface CalibrationResult {
  ok: true;
  lengthM: number;
  widthM: number;
  /** null când nu există punct de tavan (sau e invalid). */
  heightM: number | null;
  areaSqm: number;
  /** Laturile AB, BC, CD, DA în metri. */
  sides: [number, number, number, number];
  focalPx: number;
  focalSource: 'given' | 'vanishing' | 'assumed';
  /** Cât de aproape de dreptunghi este patrulaterul reconstruit (laturi opuse + unghiuri drepte). */
  quality: 'good' | 'fair' | 'poor';
  /** Abaterea maximă a unghiurilor de la 90°, în grade. */
  angleErrorDeg: number;
}

export type CalibrationOutcome = CalibrationResult | { ok: false; error: CalibrationError };

// Recomandări de referință (înălțimi standard în România)
export const REFERENCE_PRESETS = [
  { id: 'door', ro: 'Ușă standard', en: 'Standard door', fr: 'Porte standard', heightM: 2.1 },
  { id: 'door-int', ro: 'Ușă interioară (toc 2,03 m)', en: 'Interior door (2.03 m frame)', fr: 'Porte intérieure (2,03 m)', heightM: 2.03 },
  { id: 'counter', ro: 'Blat bucătărie', en: 'Kitchen counter', fr: 'Plan de travail', heightM: 0.9 },
  { id: 'outlet', ro: 'Întrerupător (axul)', en: 'Light switch (centre)', fr: 'Interrupteur (axe)', heightM: 1.1 },
] as const;

// ── Algebră ────────────────────────────────────────────────────────────────

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : a;
};
const homog = (p: Pt): V3 => [p.x, p.y, 1];

/** Rezolvă A·x = b (eliminare Gauss cu pivotare parțială). null dacă sistemul e singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Omografia 3×3 (rând-major, h33 = 1) care duce `src[i]` în `dst[i]`. */
export function solveHomography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function applyHomography(H: number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

// ── Calibrare ──────────────────────────────────────────────────────────────

/** Focala din două puncte de fugă ortogonale (omogene). null dacă nu e determinabilă. */
export function focalFromVanishing(v1: V3, v2: V3, cx: number, cy: number): number | null {
  const a = unit(v1), b = unit(v2);
  const w = a[2] * b[2];
  if (Math.abs(w) < 1e-9) return null;
  const ax = a[0] - cx * a[2], ay = a[1] - cy * a[2];
  const bx = b[0] - cx * b[2], by = b[1] - cy * b[2];
  const f2 = -(ax * bx + ay * by) / w;
  return f2 > 0 ? Math.sqrt(f2) : null;
}

export function calibrateFromPhoto(input: CalibrationInput): CalibrationOutcome {
  const { imageWidth: Wimg, imageHeight: Himg, floor, refBottom, refTop, refHeightM } = input;
  const cx = Wimg / 2, cy = Himg / 2;
  const D = Math.max(Wimg, Himg);
  const [A, B, C, Dp] = floor;

  // Patrulater degenerat (colțuri suprapuse / coliniare)
  const area2 = Math.abs((C.x - A.x) * (Dp.y - B.y) - (Dp.x - B.x) * (C.y - A.y));
  if (!(area2 > 1e-6 * D * D) || !(refHeightM > 0)) return { ok: false, error: 'degenerate' };

  const v1 = cross(cross(homog(A), homog(B)), cross(homog(Dp), homog(C)));
  const v2 = cross(cross(homog(B), homog(C)), cross(homog(A), homog(Dp)));

  let f: number;
  let focalSource: CalibrationResult['focalSource'];
  if (input.focalPx && input.focalPx > 0) {
    f = input.focalPx;
    focalSource = 'given';
  } else {
    const fv = focalFromVanishing(v1, v2, cx, cy);
    if (fv !== null && fv >= 0.3 * D && fv <= 5 * D) {
      f = fv;
      focalSource = 'vanishing';
    } else {
      f = 0.75 * D;
      focalSource = 'assumed';
    }
  }

  const kinv = (v: V3): V3 => [(v[0] - cx * v[2]) / f, (v[1] - cy * v[2]) / f, v[2]];
  const ray = (p: Pt): V3 => kinv(homog(p));
  let n = unit(cross(unit(kinv(v1)), unit(kinv(v2))));
  if (!(norm(n) > 0.5)) return { ok: false, error: 'degenerate' };

  const rays = [A, B, C, Dp].map(ray);
  if (dot(n, rays[0]) < 0) n = scale(n, -1);
  const onFloor = (r: V3): V3 | null => {
    const d = dot(n, r);
    return d > 1e-9 ? scale(r, 1 / d) : null;
  };
  const X = rays.map(onFloor);
  if (X.some((x) => x === null)) return { ok: false, error: 'behind-horizon' };
  const P = X as V3[];
  const up = scale(n, -1); // n privește de la cameră spre podea ⇒ „sus” = −n

  /** Înălțimea (unități de scenă) a punctului de pe verticala lui `base` cel mai apropiat de raza `r`. */
  const verticalHeight = (base: V3, r: V3): number | null => {
    const uu = dot(up, up), ut = dot(up, r), tt = dot(r, r);
    const sol = solveLinear([[uu, -ut], [-ut, tt]], [-dot(up, base), dot(r, base)]);
    if (!sol) return null;
    return sol[0];
  };

  const B3 = onFloor(ray(refBottom));
  if (!B3) return { ok: false, error: 'reference-invalid' };
  const hRef = verticalHeight(B3, ray(refTop));
  if (hRef === null || !(hRef > 1e-9)) return { ok: false, error: 'reference-invalid' };
  const k = refHeightM / hRef;

  const side = (i: number) => norm(sub(P[(i + 1) % 4], P[i])) * k;
  const sides: [number, number, number, number] = [side(0), side(1), side(2), side(3)];
  let L = (sides[0] + sides[2]) / 2;
  let Wd = (sides[1] + sides[3]) / 2;
  if (Wd > L) [L, Wd] = [Wd, L];

  let heightM: number | null = null;
  if (input.ceiling) {
    const hc = verticalHeight(P[0], ray(input.ceiling));
    if (hc !== null && hc > 0) heightM = hc * k;
  }

  // Calitatea: unghiurile 3D ale colțurilor + raportul laturilor opuse
  let angleErr = 0;
  for (let i = 0; i < 4; i++) {
    const a = unit(sub(P[(i + 3) % 4], P[i]));
    const b = unit(sub(P[(i + 1) % 4], P[i]));
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
    angleErr = Math.max(angleErr, Math.abs(90 - ang));
  }
  const ratio = Math.max(
    Math.abs(sides[0] - sides[2]) / Math.max(sides[0], sides[2]),
    Math.abs(sides[1] - sides[3]) / Math.max(sides[1], sides[3]),
  );
  const quality: CalibrationResult['quality'] =
    angleErr < 4 && ratio < 0.05 ? 'good' : angleErr < 12 && ratio < 0.15 ? 'fair' : 'poor';

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    ok: true,
    lengthM: r2(L),
    widthM: r2(Wd),
    heightM: heightM === null ? null : r2(heightM),
    areaSqm: r2(L * Wd),
    sides: sides.map(r2) as [number, number, number, number],
    focalPx: Math.round(f),
    focalSource,
    quality,
    angleErrorDeg: Math.round(angleErr * 10) / 10,
  };
}

/** Poziții inițiale plauzibile ale pinilor pentru o fotografie de cameră (fracțiuni din imagine). */
export function defaultPins(w: number, h: number) {
  return {
    floor: [
      { x: w * 0.3, y: h * 0.62 },
      { x: w * 0.7, y: h * 0.62 },
      { x: w * 0.92, y: h * 0.92 },
      { x: w * 0.08, y: h * 0.92 },
    ] as [Pt, Pt, Pt, Pt],
    refBottom: { x: w * 0.5, y: h * 0.63 },
    refTop: { x: w * 0.5, y: h * 0.3 },
    ceiling: { x: w * 0.3, y: h * 0.12 },
  };
}
