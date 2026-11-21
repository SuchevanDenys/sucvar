// app/lib/studio/lidarParser.ts
// „Scanare LiDAR & Măsurare Cameră” — parserul scanărilor 3D reale (iPhone / iPad LiDAR).
//
// Formate:
//   • .obj  (Wavefront: Polycam, Scaniverse, 3D Scanner App, RoomPlan → OBJ): vârfuri `v`, fețe `f`, grupuri `o`/`g`.
//   • .usdz (Apple RoomPlan / ARKit): arhivă ZIP; citim directorul central și evaluăm intrările ASCII (.usda,
//     transformări xformOp incluse) sau un .json RoomPlan inclus. Un crate binar .usdc fără limite ASCII
//     produce o eroare explicită (`usdz-binary`), nu cote inventate.
//   • .json (RoomPlan `CapturedRoom` / `CapturedStructure` Codable: `walls`, `doors`, `windows`, `openings`,
//     `floors`, transformări simd_float4x4 column-major) sau un JSON simplu cu `dimensions`.
//
// Ieșirea este mereu în cadrul local al camerei: x ∈ [0, L] (lungime), y ∈ [0, H] (sus), z ∈ [0, l] (lățime),
// în metri. Orientarea în plan se aliniază cu dreptunghiul de arie minimă (rotating calipers), deci o scanare
// rotită față de axele ARKit dă aceleași cote ca una aliniată.
//
// Modul este PUR (fără importuri, fără DOM în afară de DecompressionStream pentru ZIP-uri comprimate), ca
// testele `node --test` să-l poată încărca direct.

export type ScanSource = 'obj' | 'usdz' | 'roomplan' | 'dimensions' | 'demo';
export type LengthUnit = 'm' | 'cm' | 'mm' | 'in';
export type UpAxis = 'y' | 'z';
export type EdgeKind = 'wall' | 'floor' | 'door' | 'window' | 'opening' | 'mesh';
export type Vec3 = [number, number, number];

export interface ScanEdge {
  a: Vec3;
  b: Vec3;
  kind: EdgeKind;
}

/** Observații despre interpretarea fișierului (traduse în UI după cod). */
export type ScanNoteCode =
  | 'unit-detected'
  | 'unit-explicit'
  | 'up-z'
  | 'up-fallback'
  | 'trimmed-outliers'
  | 'rotated'
  | 'floor-from-mesh'
  | 'floor-from-polygon'
  | 'openings-standard'
  | 'edges-sampled'
  | 'implausible-size'
  | 'usda-entry'
  | 'json-entry'
  | 'zip-entry'
  | 'textured-mesh'
  | 'vertex-colors'
  | 'texture-missing';

/** O imagine de textură (JPEG / PNG / WebP) livrată alături de OBJ (arhivă ZIP sau fișiere selectate împreună). */
export interface ScanTexture {
  /** Numele de bază al fișierului (fără directoare), ca în `map_Kd`. */
  name: string;
  mime: string;
  data: Uint8Array;
}

/** Un interval de triunghiuri desenat cu același material. */
export interface ScanMeshGroup {
  /** Primul indice (în `indices`) și numărul de indici. */
  start: number;
  count: number;
  /** Textura (`ScanTexture.name`); null = culoare. */
  texture: string | null;
  /** Culoarea materialului (Kd din .mtl sau culoarea categoriei), 0–1. */
  color: [number, number, number];
}

/**
 * Plasa reală a scanării, gata pentru GPU: vârfuri de-indexate pe perechi (v, vt), triangulate, în cadrul local al
 * camerei (metri, Y-sus, aliniată la pereți — același cadru ca `edges` și cotele).
 */
export interface ScanMesh {
  positions: Float32Array;
  /** u, v pe vârf (convenția OBJ: originea jos-stânga); null = fără coordonate de textură. */
  uvs: Float32Array | null;
  /** r, g, b pe vârf (0–1); null = fără culori pe vârf. */
  colors: Float32Array | null;
  /**
   * Normalele netede pe vârf (unitare; medie ponderată cu aria fețelor adiacente, acumulată pe vârful OBJ — cusăturile
   * UV nu rup umbrirea). Sensul nu e garantat (plasele LiDAR au orientări amestecate): shader-ul le întoarce spre
   * privitor. (0, 0, 0) = vârf izolat / degenerat → shader-ul folosește normala plană.
   */
  normals: Float32Array;
  indices: Uint32Array;
  groups: ScanMeshGroup[];
  /** Texturile folosite de grupuri. */
  textures: ScanTexture[];
  /**
   * true = fețele (CCW) privesc spre interiorul camerei (scanările LiDAR: suprafața văzută de senzor). Cu eliminarea
   * fețelor din spate, pereții apropiați dispar în vederea de ansamblu („casă de păpuși”) și rămân vizibili din interior.
   */
  windingInward: boolean;
  triangleCount: number;
}

/**
 * Peretele unui gol, în cadrul local al camerei: 0 = z 0 (de-a lungul lui x), 1 = x L (de-a lungul lui z),
 * 2 = z l (de-a lungul lui x), 3 = x 0 (de-a lungul lui z).
 */
export type WallIndex = 0 | 1 | 2 | 3;

/** Un gol (ușă / fereastră / deschidere) pe un perete: poziția de-a lungul peretelui (`u0`–`u1`) și pe verticală (`y0`–`y1`), metri. */
export interface ScanOpening {
  kind: 'door' | 'window' | 'opening';
  wall: WallIndex;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  /** true = poziție standard sintetizată (fișierul dă doar numărul golurilor, nu geometria lor). */
  estimated?: boolean;
}

export interface ScanNote {
  code: ScanNoteCode;
  value?: string | number;
}

export interface RoomScan {
  source: ScanSource;
  fileName?: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  floorAreaSqm: number;
  /** Suprafața brută a pereților (perimetru × înălțime sau suma pereților RoomPlan). */
  wallAreaGrossSqm: number;
  /** Suprafața netă a pereților (golurile de uși / ferestre scăzute). */
  wallAreaNetSqm: number;
  volumeM3: number;
  wallCount: number;
  doorCount: number;
  windowCount: number;
  openingCount: number;
  unit: LengthUnit;
  upAxis: UpAxis;
  vertexCount: number;
  faceCount: number;
  /** Muchii de desenat (cadrul local al camerei, metri). */
  edges: ScanEdge[];
  /** Eșantion de puncte (x, y, z consecutive) pentru scanările fără fețe. */
  cloud: number[];
  /** Golurile cu poziția lor pe pereți (exacte din geometrie sau standard, vezi `estimated`). */
  openings: ScanOpening[];
  notes: ScanNote[];
  /** Plasa reală (OBJ cu fețe): randată texturat / colorat în locul schemei. Absentă la JSON / USD / demo. */
  mesh?: ScanMesh;
}

export type ScanErrorCode =
  | 'empty'
  | 'unsupported'
  | 'no-vertices'
  | 'invalid-json'
  | 'no-room'
  | 'zip-invalid'
  | 'usdz-binary'
  | 'usdz-empty'
  | 'zip-no-model'
  | 'degenerate';

/** Pragurile sub care o plasă nu mai descrie o cameră (puncte suprapuse, doar podeaua etc.). */
const MIN_ROOM_SIDE_M = 0.3;
const MIN_ROOM_HEIGHT_M = 1;

export class ScanParseError extends Error {
  code: ScanErrorCode;
  detail?: string;
  constructor(code: ScanErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ScanParseError';
    this.code = code;
    this.detail = detail;
  }
}

export interface ParseOptions {
  /** Forțează axa verticală (altfel: detectare automată). */
  upAxis?: UpAxis;
  /** Forțează unitatea (altfel: detectare automată). */
  unit?: LengthUnit;
  fileName?: string;
}

// ── Constante ────────────────────────────────────────────────────────────────

const UNIT_SCALE: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };
const UNIT_ORDER: LengthUnit[] = ['m', 'cm', 'mm', 'in'];
/** Aceleași goluri standard ca în `lib/studio/validation.ts` (ușă 0,90 × 2,10; fereastră 1,40 × 1,50). */
export const STANDARD_DOOR_AREA = 1.89;
export const STANDARD_WINDOW_AREA = 2.1;
const PLAUSIBLE_HEIGHT = { min: 1.8, max: 8 };
const PLAUSIBLE_PLAN = { min: 0.5, max: 150 };
const MAX_EDGES = 4000;
const MAX_CLOUD_POINTS = 1800;
const FEATURE_FACE_LIMIT = 150_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Geometrie 2D: învelitoare convexă + dreptunghi de arie minimă ───────────

type P2 = [number, number];

function convexHull(points: P2[]): P2[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface PlanFrame {
  /** Colțul de origine (în planul orizontal al fișierului). */
  origin: P2;
  /** Direcția lungimii (versor). */
  u: P2;
  /** Direcția lățimii (versor). */
  v: P2;
  length: number;
  width: number;
  /** Unghiul lui `u` față de axa X a fișierului (radiani). */
  angle: number;
}

/** Dreptunghiul de arie minimă care încadrează punctele (rotating calipers pe învelitoarea convexă). */
export function minAreaRect(points: P2[]): PlanFrame {
  if (points.length === 0) return { origin: [0, 0], u: [1, 0], v: [0, 1], length: 0, width: 0, angle: 0 };
  const hull = convexHull(points);
  const project = (u: P2, v: P2) => {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = p[0] * u[0] + p[1] * u[1];
      const pv = p[0] * v[0] + p[1] * v[1];
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    return { minU, maxU, minV, maxV, area: (maxU - minU) * (maxV - minV) };
  };
  // Referința: dreptunghiul aliniat la axe (păstrat când rotația nu aduce un câștig real)
  const axis = project([1, 0], [0, 1]);
  let best = { ...axis, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const angle = Math.atan2(dy, dx);
    const r = project([dx / len, dy / len], [-dy / len, dx / len]);
    if (r.area < best.area - 1e-12) best = { ...r, angle };
  }
  if (axis.area <= best.area * 1.003) best = { ...axis, angle: 0 };

  let u: P2 = [Math.cos(best.angle), Math.sin(best.angle)];
  let v: P2 = [-Math.sin(best.angle), Math.cos(best.angle)];
  let { minU, maxU, minV, maxV } = best;
  let angle = best.angle;
  // Lungimea = latura mai mare
  if (maxV - minV > maxU - minU + 1e-9) {
    const nu: P2 = v;
    const nv: P2 = [-u[0], -u[1]];
    [minU, maxU, minV, maxV] = [minV, maxV, -maxU, -minU];
    u = nu;
    v = nv;
    angle += Math.PI / 2;
  }
  const origin: P2 = [minU * u[0] + minV * v[0], minU * u[1] + minV * v[1]];
  return { origin, u, v, length: maxU - minU, width: maxV - minV, angle };
}

function shoelace(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

// ── Detectarea unității și a axei verticale ─────────────────────────────────

export function detectUnitAndUp(
  ext: Vec3,
  opts: { unit?: LengthUnit; upAxis?: UpAxis } = {},
): { unit: LengthUnit; upAxis: UpAxis; plausible: boolean; reason: 'explicit' | 'detected' | 'fallback' } {
  const units = opts.unit ? [opts.unit] : UNIT_ORDER;
  const inPlan = (n: number) => n >= PLAUSIBLE_PLAN.min && n <= PLAUSIBLE_PLAN.max;
  const inHeight = (n: number) => n >= PLAUSIBLE_HEIGHT.min && n <= PLAUSIBLE_HEIGHT.max;
  for (const unit of units) {
    const s = UNIT_SCALE[unit];
    const [x, y, z] = [ext[0] * s, ext[1] * s, ext[2] * s];
    const yOk = inHeight(y) && inPlan(x) && inPlan(z);
    const zOk = inHeight(z) && inPlan(x) && inPlan(y);
    if (opts.upAxis) {
      if (opts.upAxis === 'y' ? yOk : zOk) return { unit, upAxis: opts.upAxis, plausible: true, reason: opts.unit ? 'explicit' : 'detected' };
      continue;
    }
    // Ambele plauzibile: o cutie goală e simetrică, deci geometria singură nu poate decide. Toate exporturile
    // iOS / ARKit (RoomPlan, Polycam, Scaniverse) sunt Y-sus; Z-sus vine din CAD / Blender cu comentariu
    // `# up_axis: Z` sau se alege manual din UI (opțiunea `upAxis`).
    if (yOk) return { unit, upAxis: 'y', plausible: true, reason: opts.unit ? 'explicit' : 'detected' };
    if (zOk) return { unit, upAxis: 'z', plausible: true, reason: opts.unit ? 'explicit' : 'detected' };
  }
  return { unit: opts.unit ?? 'm', upAxis: opts.upAxis ?? 'y', plausible: false, reason: 'fallback' };
}

// ── Pipeline comun pentru plase de puncte / fețe ────────────────────────────

interface MeshInput {
  /** x, y, z consecutive (unități brute ale fișierului). */
  positions: number[];
  /** Fețe: indici de vârf (0-based) pe poligon. */
  faces: number[][];
  /** Categoria fiecărei fețe (din numele grupului), paralel cu `faces`. */
  faceKinds: (EdgeKind | null)[];
  /** Nume distincte de grupuri pe categorie (RoomPlan → OBJ: Wall0, Door0, Window1…). */
  groups: Record<'wall' | 'door' | 'window' | 'opening', Set<string>>;
  /** Grupul de gol (Door0, Window1…) al fiecărei fețe, paralel cu `faces` (null = nu e un gol). */
  faceGroups?: (string | null)[];
  /** Datele de randare ale plasei reale (OBJ). */
  render?: RenderInput;
}

/** Plasa OBJ triangulată, înainte de alinierea la cadrul camerei. */
interface RenderInput {
  /** u, v consecutive (`vt`). */
  uvs: number[];
  /** r, g, b pe vârf (paralel cu `positions`), deja normalizate 0–1; null = fără culori. */
  colors: number[] | null;
  /** Colțurile triunghiurilor: indicele vârfului și al coordonatei de textură (−1 = fără). */
  triV: number[];
  triT: number[];
  /** Grupul de randare al fiecărui triunghi (indice în `slots`). */
  triSlot: number[];
  /** Grupurile de randare: textura și culoarea fiecăruia. */
  slots: { texture: string | null; color: [number, number, number] }[];
  textures: ScanTexture[];
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

function analyzeMesh(
  mesh: MeshInput,
  source: ScanSource,
  opts: ParseOptions & { explicitUnit?: LengthUnit; explicitUp?: UpAxis; extraNotes?: ScanNote[] },
): RoomScan {
  const n = Math.floor(mesh.positions.length / 3);
  if (n < 4) throw new ScanParseError('no-vertices');
  const notes: ScanNote[] = [...(opts.extraNotes ?? [])];

  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = mesh.positions[i * 3];
    ys[i] = mesh.positions[i * 3 + 1];
    zs[i] = mesh.positions[i * 3 + 2];
  }

  // Limite robuste: la plasele mari (fotogrammetrie) ignorăm 0,2 % din vârfurile extreme (zgomot prin ferestre)
  const trim = n > 5000;
  const bounds = (arr: Float64Array) => {
    if (!trim) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] < lo) lo = arr[i];
        if (arr[i] > hi) hi = arr[i];
      }
      return [lo, hi] as const;
    }
    const s = Float64Array.from(arr).sort();
    return [percentile(s, 0.002), percentile(s, 0.998)] as const;
  };
  const [minX, maxX] = bounds(xs);
  const [minY, maxY] = bounds(ys);
  const [minZ, maxZ] = bounds(zs);
  if (trim) notes.push({ code: 'trimmed-outliers' });
  if (![minX, maxX, minY, maxY, minZ, maxZ].every(Number.isFinite)) throw new ScanParseError('no-vertices');

  const unitOpt = opts.unit ?? opts.explicitUnit;
  const upOpt = opts.upAxis ?? opts.explicitUp;
  const det = detectUnitAndUp([maxX - minX, maxY - minY, maxZ - minZ], { unit: unitOpt, upAxis: upOpt });
  const scale = UNIT_SCALE[det.unit];
  const upAxis = det.upAxis;
  if (!det.plausible) notes.push({ code: 'implausible-size' });
  if (opts.unit || opts.explicitUnit) notes.push({ code: 'unit-explicit', value: det.unit });
  else notes.push({ code: 'unit-detected', value: det.unit });
  if (upAxis === 'z') notes.push({ code: 'up-z' });
  else if (!upOpt && det.plausible) {
    // Y ales implicit deși și Z ar fi fost o înălțime plauzibilă: semnalăm în UI comutatorul Y / Z
    const zH = (maxZ - minZ) * scale;
    if (zH >= PLAUSIBLE_HEIGHT.min && zH <= PLAUSIBLE_HEIGHT.max) notes.push({ code: 'up-fallback' });
  }

  // Cadrul „Y-sus, metri”: (orizontal1, sus, orizontal2). Z-sus → (x, z, −y) (dreapta păstrată).
  const H1 = xs;
  const UP = upAxis === 'y' ? ys : zs;
  const H2 = upAxis === 'y' ? zs : ys;
  const h2Sign = upAxis === 'y' ? 1 : -1;
  const [upMin, upMax] = upAxis === 'y' ? [minY, maxY] : [minZ, maxZ];

  // Plan: dreptunghiul minim pe un eșantion de până la 20 000 de puncte din interiorul limitelor
  const stride = Math.max(1, Math.floor(n / 20000));
  const plan: P2[] = [];
  const inBounds = (i: number) =>
    xs[i] >= minX && xs[i] <= maxX && ys[i] >= minY && ys[i] <= maxY && zs[i] >= minZ && zs[i] <= maxZ;
  for (let i = 0; i < n; i += stride) {
    if (!trim || inBounds(i)) plan.push([H1[i] * scale, H2[i] * h2Sign * scale]);
  }
  const frame = minAreaRect(plan);
  if (Math.abs(Math.sin(frame.angle * 2)) > 0.02) notes.push({ code: 'rotated', value: Math.round((frame.angle * 180) / Math.PI) });

  const floorY = upMin * scale;
  const heightM = (upMax - upMin) * scale;
  // Plasă degenerată (puncte suprapuse, doar podeaua, o linie): nu descrie o cameră — fără cote de 0 m în Studio
  if (!(Math.min(frame.length, frame.width) >= MIN_ROOM_SIDE_M && heightM >= MIN_ROOM_HEIGHT_M))
    throw new ScanParseError('degenerate', `${r2(frame.length)} × ${r2(frame.width)} × ${r2(heightM)} m`);
  const toLocal = (i: number): Vec3 => {
    const px = H1[i] * scale - frame.origin[0];
    const pz = H2[i] * h2Sign * scale - frame.origin[1];
    return [px * frame.u[0] + pz * frame.u[1], UP[i] * scale - floorY, px * frame.v[0] + pz * frame.v[1]];
  };

  // ── Fețe: arie de podea + muchii caracteristice ──
  const edges: ScanEdge[] = [];
  let floorUp = 0, floorDown = 0;
  const faceCount = mesh.faces.length;
  const useFeatures = faceCount > 0 && faceCount <= FEATURE_FACE_LIMIT;
  const normals: Vec3[] = [];
  const floorBand = heightM * 0.12;
  for (let f = 0; f < faceCount; f++) {
    const poly = mesh.faces[f];
    if (poly.length < 3) {
      normals.push([0, 0, 0]);
      continue;
    }
    // Normala Newell + aria poligonului (în metri, cadrul Y-sus)
    let nx = 0, ny = 0, nz = 0;
    let cy = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const ax = H1[a] * scale, ay = UP[a] * scale, az = H2[a] * h2Sign * scale;
      const bx = H1[b] * scale, by = UP[b] * scale, bz = H2[b] * h2Sign * scale;
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
      cy += ay;
    }
    // Newell în sistem dreapta; Z-sus a inversat o axă orizontală, deci și orientarea fețelor se inversează
    if (h2Sign < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz);
    const area = len / 2;
    const nrm: Vec3 = len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
    normals.push(nrm);
    cy = cy / poly.length - floorY;
    if (cy <= floorBand && area > 0) {
      if (nrm[1] > 0.9) floorUp += area;
      else if (nrm[1] < -0.9) floorDown += area;
    }
  }

  const rectArea = frame.length * frame.width;
  const meshFloor = Math.max(floorUp, floorDown);
  let floorAreaSqm = rectArea;
  if (meshFloor >= rectArea * 0.35 && meshFloor <= rectArea * 1.05) {
    floorAreaSqm = meshFloor;
    notes.push({ code: 'floor-from-mesh' });
  }

  if (faceCount > 0) {
    if (useFeatures) {
      // Muchii de margine (o singură față) sau cu unghi diedru > ~25°: contururi arhitecturale curate
      const pending = new Map<number, number>();
      const out: [number, number, number][] = [];
      for (let f = 0; f < faceCount; f++) {
        const poly = mesh.faces[f];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          if (a === b) continue;
          const key = a < b ? a * n + b : b * n + a;
          const prev = pending.get(key);
          if (prev === undefined) pending.set(key, f);
          else if (prev >= 0) {
            const na = normals[prev], nb = normals[f];
            if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < 0.9) out.push([a, b, f]);
            pending.set(key, -1);
          }
        }
      }
      for (const [key, f] of pending) {
        if (f < 0) continue;
        out.push([Math.floor(key / n), key % n, f]);
      }
      const step = Math.max(1, Math.ceil(out.length / MAX_EDGES));
      if (step > 1) notes.push({ code: 'edges-sampled', value: out.length });
      for (let i = 0; i < out.length; i += step) {
        const [a, b, f] = out[i];
        edges.push({ a: toLocal(a), b: toLocal(b), kind: mesh.faceKinds[f] ?? 'mesh' });
      }
    } else {
      // Plasă foarte mare: eșantion uniform de laturi (fără analiză diedrală)
      let total = 0;
      for (const p of mesh.faces) total += p.length;
      const step = Math.max(1, Math.ceil(total / MAX_EDGES));
      let c = 0;
      for (let f = 0; f < faceCount; f++) {
        const poly = mesh.faces[f];
        for (let k = 0; k < poly.length; k++, c++) {
          if (c % step) continue;
          edges.push({ a: toLocal(poly[k]), b: toLocal(poly[(k + 1) % poly.length]), kind: mesh.faceKinds[f] ?? 'mesh' });
        }
      }
      notes.push({ code: 'edges-sampled', value: total });
    }
  }

  const cloud: number[] = [];
  if (faceCount === 0) {
    const cs = Math.max(1, Math.floor(n / MAX_CLOUD_POINTS));
    for (let i = 0; i < n; i += cs) {
      if (trim && !inBounds(i)) continue;
      cloud.push(...toLocal(i));
    }
  }

  const L = frame.length, W = frame.width;
  edges.push(...boxEdges(L, W, heightM));
  const renderMesh = mesh.render && mesh.render.triV.length >= 3 ? buildRenderMesh(mesh.render, n, toLocal, [L / 2, heightM / 2, W / 2]) : undefined;

  // Golurile: cutia vârfurilor fiecărui grup Door* / Window* / Opening*, proiectată pe peretele cel mai apropiat
  const openingPts = new Map<string, { kind: ScanOpening['kind']; pts: Vec3[] }>();
  if (mesh.faceGroups) {
    for (let f = 0; f < faceCount; f++) {
      const g = mesh.faceGroups[f];
      const k = mesh.faceKinds[f];
      if (!g || (k !== 'door' && k !== 'window' && k !== 'opening')) continue;
      let entry = openingPts.get(g);
      if (!entry) openingPts.set(g, (entry = { kind: k, pts: [] }));
      for (const i of mesh.faces[f]) entry.pts.push(toLocal(i));
    }
  }
  const meshOpenings: ScanOpening[] = [];
  for (const { kind, pts } of openingPts.values()) {
    const o = openingFromPoints(kind, pts, L, W, heightM);
    if (o) meshOpenings.push(o);
  }

  const doorCount = mesh.groups.door.size;
  const windowCount = mesh.groups.window.size;
  const openingCount = mesh.groups.opening.size;
  const gross = 2 * (L + W) * heightM;
  const openings = doorCount * STANDARD_DOOR_AREA + windowCount * STANDARD_WINDOW_AREA;
  if (openings > 0) notes.push({ code: 'openings-standard' });

  return finalize({
    source,
    fileName: opts.fileName,
    lengthM: L,
    widthM: W,
    heightM,
    floorAreaSqm,
    wallAreaGrossSqm: gross,
    wallAreaNetSqm: Math.max(0, gross - openings),
    volumeM3: floorAreaSqm * heightM,
    wallCount: mesh.groups.wall.size,
    doorCount,
    windowCount,
    openingCount,
    unit: det.unit,
    upAxis,
    vertexCount: n,
    faceCount,
    edges,
    cloud,
    openings: meshOpenings,
    notes,
    mesh: renderMesh,
  });
}

/**
 * Plasa GPU: un vârf pe fiecare pereche distinctă (v, vt) — cusăturile texturii rămân exacte —, triunghiurile
 * ordonate pe grupuri de randare, pozițiile în cadrul local al camerei.
 */
function buildRenderMesh(r: RenderInput, vertexCount: number, toLocal: (i: number) => Vec3, center: Vec3): ScanMesh {
  const triCount = Math.floor(r.triV.length / 3);
  const uvCount = r.uvs.length / 2;
  const hasUv = uvCount > 0 && r.triT.some((t) => t >= 0);

  // Vârfurile GPU: (v, vt) → indice nou (fără UV: chiar indicele vârfului)
  const remap = new Map<number, number>();
  const srcV: number[] = [];
  const srcT: number[] = [];
  const corner = new Uint32Array(triCount * 3);
  for (let k = 0; k < triCount * 3; k++) {
    const v = r.triV[k];
    if (!hasUv) {
      corner[k] = v;
      continue;
    }
    const t = r.triT[k];
    const key = v * (uvCount + 1) + (t + 1);
    let idx = remap.get(key);
    if (idx === undefined) {
      idx = srcV.length;
      remap.set(key, idx);
      srcV.push(v);
      srcT.push(t);
    }
    corner[k] = idx;
  }
  const nv = hasUv ? srcV.length : vertexCount;
  const positions = new Float32Array(nv * 3);
  const uvs = hasUv ? new Float32Array(nv * 2) : null;
  const colors = r.colors ? new Float32Array(nv * 3) : null;
  for (let i = 0; i < nv; i++) {
    const v = hasUv ? srcV[i] : i;
    const p = toLocal(v);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    if (uvs) {
      const t = srcT[i];
      if (t >= 0) {
        uvs[i * 2] = r.uvs[t * 2];
        uvs[i * 2 + 1] = r.uvs[t * 2 + 1];
      }
    }
    if (colors && r.colors) {
      colors[i * 3] = r.colors[v * 3];
      colors[i * 3 + 1] = r.colors[v * 3 + 1];
      colors[i * 3 + 2] = r.colors[v * 3 + 2];
    }
  }

  // Normalele netede: produsul vectorial nenormalizat (= 2 × aria) acumulat pe vârful OBJ, apoi copiat pe vârfurile GPU
  const acc = new Float64Array(vertexCount * 3);
  const src = (k: number) => (hasUv ? srcV[corner[k]] : corner[k]);
  for (let f = 0; f < triCount; f++) {
    const a = corner[f * 3], b = corner[f * 3 + 1], c = corner[f * 3 + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax, e1y = positions[b * 3 + 1] - ay, e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax, e2y = positions[c * 3 + 1] - ay, e2z = positions[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (let j = 0; j < 3; j++) {
      const v = src(f * 3 + j) * 3;
      acc[v] += nx;
      acc[v + 1] += ny;
      acc[v + 2] += nz;
    }
  }
  const normals = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const v = (hasUv ? srcV[i] : i) * 3;
    const x = acc[v], y = acc[v + 1], z = acc[v + 2];
    const l = Math.hypot(x, y, z);
    if (l > 1e-12) {
      normals[i * 3] = x / l;
      normals[i * 3 + 1] = y / l;
      normals[i * 3 + 2] = z / l;
    }
  }

  // Triunghiurile ordonate pe grup (sortare prin numărare): un singur apel de desen per material
  const slotCount = Math.max(1, r.slots.length);
  const counts = new Array<number>(slotCount).fill(0);
  for (let f = 0; f < triCount; f++) counts[r.triSlot[f] ?? 0]++;
  const starts = new Array<number>(slotCount).fill(0);
  for (let s = 1; s < slotCount; s++) starts[s] = starts[s - 1] + counts[s - 1];
  const cursor = starts.slice();
  const indices = new Uint32Array(triCount * 3);
  // Orientarea fețelor: Σ normală · (centroid − centrul camerei), ponderat cu aria (negativ = spre interior)
  let facing = 0;
  for (let f = 0; f < triCount; f++) {
    const s = r.triSlot[f] ?? 0;
    const o = cursor[s]++ * 3;
    const a = corner[f * 3], b = corner[f * 3 + 1], c = corner[f * 3 + 2];
    indices[o] = a;
    indices[o + 1] = b;
    indices[o + 2] = c;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax, e1y = positions[b * 3 + 1] - ay, e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax, e2y = positions[c * 3 + 1] - ay, e2z = positions[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const cx = (ax + positions[b * 3] + positions[c * 3]) / 3 - center[0];
    const cy = (ay + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3 - center[1];
    const cz = (az + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3 - center[2];
    facing += nx * cx + ny * cy + nz * cz;
  }
  const groups: ScanMeshGroup[] = [];
  for (let s = 0; s < slotCount; s++) {
    if (!counts[s]) continue;
    const slot = r.slots[s] ?? { texture: null, color: DEFAULT_MESH_COLOR };
    groups.push({ start: starts[s] * 3, count: counts[s] * 3, texture: hasUv ? slot.texture : null, color: slot.color });
  }
  const used = new Set(groups.map((g) => g.texture).filter(Boolean));
  return {
    positions,
    uvs,
    colors,
    normals,
    indices,
    groups,
    textures: r.textures.filter((t) => used.has(t.name)),
    windingInward: facing <= 0,
    triangleCount: triCount,
  };
}

const DEFAULT_MESH_COLOR: [number, number, number] = [0.9, 0.87, 0.83];
/** Culorile categoriilor (RoomPlan → OBJ fără material): pereți calzi, uși șampanie, ferestre reci. */
const KIND_COLOR: Record<EdgeKind, [number, number, number]> = {
  wall: [0.93, 0.91, 0.88],
  floor: [0.84, 0.79, 0.73],
  door: [0.8, 0.71, 0.6],
  window: [0.78, 0.86, 0.9],
  opening: [0.85, 0.8, 0.75],
  mesh: DEFAULT_MESH_COLOR,
};

/** Cutia camerei: perimetrul podelei + muchiile verticale + perimetrul tavanului. */
function boxEdges(L: number, W: number, H: number): ScanEdge[] {
  const c: Vec3[] = [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]];
  const out: ScanEdge[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    out.push({ a, b, kind: 'floor' });
    out.push({ a: [a[0], H, a[2]], b: [b[0], H, b[2]], kind: 'wall' });
    out.push({ a, b: [a[0], H, a[2]], kind: 'wall' });
  }
  return out;
}

/** Golul descris de punctele lui (cadrul local): peretele cel mai apropiat de centru + cutia de-a lungul lui. */
export function openingFromPoints(kind: ScanOpening['kind'], pts: Vec3[], L: number, W: number, H: number): ScanOpening | null {
  if (pts.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, y, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const dist = [Math.abs(cz), Math.abs(L - cx), Math.abs(W - cz), Math.abs(cx)];
  const wall = dist.indexOf(Math.min(...dist)) as WallIndex;
  const along = wall === 0 || wall === 2 ? [minX, maxX] : [minZ, maxZ];
  const span = wall === 0 || wall === 2 ? L : W;
  const u0 = clampN(along[0], 0, span), u1 = clampN(along[1], 0, span);
  const y0 = clampN(minY, 0, H), y1 = clampN(maxY, 0, H);
  if (u1 - u0 < 0.15 || y1 - y0 < 0.15) return null;
  return { kind, wall, u0: r2(u0), u1: r2(u1), y0: r2(y0), y1: r2(y1) };
}

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Lungimea peretelui `wall` (L pentru 0 / 2, l pentru 1 / 3). */
export const wallSpan = (wall: WallIndex, L: number, W: number) => (wall === 0 || wall === 2 ? L : W);

/**
 * Completează golurile lipsă cu poziții standard (fișierul dă doar numărul lor): ușa 0,90 × 2,10 m lângă colțul
 * peretelui 3, ferestrele 1,40 × 1,50 m (parapet 0,85 m) centrate pe pereții 2, 1, 0 — câte una pe perete, apoi alternând.
 */
export function completeOpenings(existing: ScanOpening[], doors: number, windows: number, L: number, W: number, H: number): ScanOpening[] {
  const out = existing.slice();
  const count = (k: ScanOpening['kind']) => out.filter((o) => o.kind === k).length;
  for (let i = count('door'); i < doors; i++) {
    const wall: WallIndex = i % 2 === 0 ? 3 : 0;
    const span = wallSpan(wall, L, W);
    const w = Math.min(0.9, span * 0.4);
    const u0 = Math.min(0.3 + Math.floor(i / 2) * 1.3, Math.max(0, span - w));
    out.push({ kind: 'door', wall, u0: r2(u0), u1: r2(u0 + w), y0: 0, y1: r2(Math.min(2.1, H - 0.1)), estimated: true });
  }
  const order: WallIndex[] = [2, 1, 0];
  const nWin = Math.max(0, windows - count('window'));
  const perWall = new Map<WallIndex, number>();
  for (let i = 0; i < nWin; i++) {
    const wall = order[i % order.length];
    perWall.set(wall, (perWall.get(wall) ?? 0) + 1);
  }
  for (const [wall, n] of perWall) {
    const span = wallSpan(wall, L, W);
    const w = Math.min(1.4, (span / n) * 0.6);
    const y0 = Math.min(0.85, H * 0.32);
    const y1 = Math.min(y0 + 1.5, H - 0.2);
    for (let k = 0; k < n; k++) {
      const c = (span * (k + 0.5)) / n;
      out.push({ kind: 'window', wall, u0: r2(c - w / 2), u1: r2(c + w / 2), y0: r2(y0), y1: r2(y1), estimated: true });
    }
  }
  return out;
}

function finalize(scan: RoomScan): RoomScan {
  const L = r2(scan.lengthM), W = r2(scan.widthM), H = r2(scan.heightM);
  return {
    ...scan,
    openings: completeOpenings(scan.openings, scan.doorCount, scan.windowCount, L, W, H),
    lengthM: r2(scan.lengthM),
    widthM: r2(scan.widthM),
    heightM: r2(scan.heightM),
    floorAreaSqm: r2(scan.floorAreaSqm),
    wallAreaGrossSqm: r2(scan.wallAreaGrossSqm),
    wallAreaNetSqm: r2(scan.wallAreaNetSqm),
    volumeM3: r2(scan.volumeM3),
  };
}

// ── OBJ ───────────────────────────────────────────────────────────────────────

function groupKind(name: string): EdgeKind | null {
  const s = name.toLowerCase();
  if (/door|usa|ușă/.test(s)) return 'door';
  if (/window|fereastr/.test(s)) return 'window';
  if (/opening|gol/.test(s)) return 'opening';
  if (/floor|podea/.test(s)) return 'floor';
  if (/wall|perete/.test(s)) return 'wall';
  return null;
}

function emptyGroups(): MeshInput['groups'] {
  return { wall: new Set(), door: new Set(), window: new Set(), opening: new Set() };
}

function unitHint(text: string): LengthUnit | undefined {
  const m = /#.*\bunits?\s*[:=]?\s*(millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|met(?:er|re)s?|m|inch(?:es)?|in)\b/i.exec(text.slice(0, 4000));
  if (!m) return undefined;
  const u = m[1].toLowerCase();
  if (u.startsWith('mm') || u.startsWith('milli')) return 'mm';
  if (u.startsWith('cm') || u.startsWith('centi')) return 'cm';
  if (u.startsWith('in')) return 'in';
  return 'm';
}

function upHint(text: string): UpAxis | undefined {
  const m = /#.*\b(?:up[_\s-]?axis\s*[:=]?\s*([yz])\b|([yz])[\s-]?up\b)/i.exec(text.slice(0, 4000));
  if (!m) return undefined;
  return (m[1] ?? m[2]).toLowerCase() as UpAxis;
}

/** Fișierele însoțitoare ale unui OBJ: materialele (.mtl) și texturile (JPEG / PNG / WebP). */
export interface ObjAssets {
  mtl?: { name: string; text: string }[];
  textures?: ScanTexture[];
}

interface MtlMaterial {
  map?: string;
  kd?: [number, number, number];
}

const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

/** `newmtl` → `map_Kd` (numele de bază, opțiunile `-o 0 0 0`, `-bm 1` etc. sunt ignorate) + `Kd`. */
export function parseMtl(text: string): Map<string, MtlMaterial> {
  const out = new Map<string, MtlMaterial>();
  let cur: MtlMaterial | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sp = line.search(/\s/);
    if (sp < 0) continue;
    const key = line.slice(0, sp).toLowerCase();
    const rest = line.slice(sp + 1).trim();
    if (key === 'newmtl') {
      cur = {};
      out.set(rest, cur);
    } else if (cur && key === 'map_kd') {
      const tokens = rest.split(/\s+/);
      let i = 0;
      while (i < tokens.length - 1 && tokens[i].startsWith('-')) {
        i++;
        while (i < tokens.length - 1 && /^-?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(tokens[i])) i++;
        if (/^(on|off)$/i.test(tokens[i]) && i < tokens.length - 1) i++;
      }
      cur.map = baseName(tokens.slice(i).join(' '));
    } else if (cur && key === 'kd') {
      const v = rest.split(/\s+/).map(Number);
      if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) cur.kd = [v[0], v[1], v[2]];
    }
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Tipul MIME al unei texturi după extensie (null = nu e o imagine acceptată). */
export function textureMime(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

export function parseObj(text: string, opts: ParseOptions = {}, assets: ObjAssets = {}, extraNotes: ScanNote[] = []): RoomScan {
  if (!text.trim()) throw new ScanParseError('empty');
  const positions: number[] = [];
  const faces: number[][] = [];
  const faceKinds: (EdgeKind | null)[] = [];
  const groups = emptyGroups();
  const faceGroups: (string | null)[] = [];
  let currentKind: EdgeKind | null = null;
  let currentGroup: string | null = null;
  // Randare: coordonate de textură, culori pe vârf, colțurile triunghiurilor, materialul curent
  const uvs: number[] = [];
  const colors: number[] = [];
  let coloredVertices = 0;
  let maxColor = 0;
  const triV: number[] = [];
  const triT: number[] = [];
  const triSlot: number[] = [];
  const slotKeys = new Map<string, number>();
  const slotDefs: { material: string | null; kind: EdgeKind | null }[] = [];
  let currentMaterial: string | null = null;
  let currentSlot = -1;
  const polyV: number[] = [];
  const polyT: number[] = [];

  const isSep = (c: number) => c === 32 || c === 9;
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    // Linii relevante: „v ”, „vt ”, „f ”, „o ”, „g ”, „usemtl ” (vn, mtllib, comentarii — ignorate)
    if (c0 === 118 /* v */ && isSep(c1)) {
      const parts = text.slice(start + 2, end).trim().split(/\s+/);
      const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        positions.push(x, y, z);
        // Culori pe vârf (Scaniverse / Polycam / MeshLab): `v x y z r g b`
        const r = Number(parts[3]), g = Number(parts[4]), b = Number(parts[5]);
        if (parts.length >= 6 && Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          colors.push(r, g, b);
          coloredVertices++;
          maxColor = Math.max(maxColor, r, g, b);
        } else colors.push(NaN, NaN, NaN); // completat după normalizare (altfel gri-ul implicit ar fi împărțit la 255)
      }
    } else if (c0 === 118 /* v */ && c1 === 116 /* t */ && isSep(text.charCodeAt(start + 2))) {
      const parts = text.slice(start + 3, end).trim().split(/\s+/);
      const u = Number(parts[0]), v = Number(parts[1]);
      uvs.push(Number.isFinite(u) ? u : 0, Number.isFinite(v) ? v : 0);
    } else if (c0 === 102 /* f */ && isSep(c1)) {
      const parts = text.slice(start + 2, end).trim().split(/\s+/);
      const count = positions.length / 3;
      const uvCount = uvs.length / 2;
      polyV.length = 0;
      polyT.length = 0;
      for (const p of parts) {
        const raw = parseInt(p, 10); // „12/5/7” → 12
        if (!Number.isFinite(raw) || raw === 0) continue;
        const idx = raw > 0 ? raw - 1 : count + raw;
        if (idx < 0 || idx >= count) continue;
        let t = -1;
        const s1 = p.indexOf('/');
        if (s1 >= 0) {
          const s2 = p.indexOf('/', s1 + 1);
          const rawT = parseInt(s2 < 0 ? p.slice(s1 + 1) : p.slice(s1 + 1, s2), 10); // „12//7” → NaN
          if (Number.isFinite(rawT) && rawT !== 0) {
            const ti = rawT > 0 ? rawT - 1 : uvCount + rawT;
            if (ti >= 0 && ti < uvCount) t = ti;
          }
        }
        polyV.push(idx);
        polyT.push(t);
      }
      if (polyV.length >= 2) {
        faces.push(polyV.slice());
        faceKinds.push(currentKind);
        faceGroups.push(currentGroup);
      }
      if (polyV.length >= 3) {
        if (currentSlot < 0) {
          const key = `${currentMaterial ?? ''}\u0000${currentMaterial ? '' : currentKind ?? ''}`;
          let s = slotKeys.get(key);
          if (s === undefined) {
            s = slotDefs.length;
            slotKeys.set(key, s);
            slotDefs.push({ material: currentMaterial, kind: currentMaterial ? null : currentKind });
          }
          currentSlot = s;
        }
        // Evantai: (0, k, k + 1)
        for (let k = 1; k + 1 < polyV.length; k++) {
          triV.push(polyV[0], polyV[k], polyV[k + 1]);
          triT.push(polyT[0], polyT[k], polyT[k + 1]);
          triSlot.push(currentSlot);
        }
      }
    } else if ((c0 === 111 /* o */ || c0 === 103 /* g */) && c1 === 32) {
      const name = text.slice(start + 2, end).trim();
      currentKind = groupKind(name);
      currentGroup = currentKind === 'door' || currentKind === 'window' || currentKind === 'opening' ? name : null;
      if (currentKind && currentKind !== 'floor' && currentKind !== 'mesh') groups[currentKind].add(name);
      currentSlot = -1;
    } else if (c0 === 117 /* u */ && text.startsWith('usemtl', start) && isSep(text.charCodeAt(start + 6))) {
      currentMaterial = text.slice(start + 7, end).trim() || null;
      currentSlot = -1;
    }
    start = end + 1;
  }
  if (positions.length < 12) throw new ScanParseError('no-vertices');

  // Materiale → texturi: `map_Kd` după numele de bază; o singură imagine fără .mtl = textura întregii plase
  const materials = new Map<string, MtlMaterial>();
  for (const m of assets.mtl ?? []) for (const [k, v] of parseMtl(m.text)) materials.set(k, v);
  const textures = assets.textures ?? [];
  const byName = new Map(textures.map((t) => [t.name.toLowerCase(), t] as const));
  const notes: ScanNote[] = [...extraNotes];
  const missing = new Set<string>();
  const slots = (slotDefs.length ? slotDefs : [{ material: null, kind: null }]).map(({ material, kind }) => {
    const mat = material ? materials.get(material) : undefined;
    let tex: ScanTexture | undefined;
    if (mat?.map) {
      tex = byName.get(mat.map.toLowerCase());
      if (!tex) {
        if (textures.length === 1) tex = textures[0];
        else missing.add(mat.map);
      }
    } else if (!mat?.kd && textures.length === 1) {
      tex = textures[0];
    }
    const color = mat?.kd && mat.kd.some((c) => c > 0.02) ? mat.kd : KIND_COLOR[kind ?? 'mesh'];
    return { texture: tex?.name ?? null, color };
  });
  const hasUv = uvs.length > 0 && triT.some((t) => t >= 0);
  const textured = hasUv && slots.some((s) => s.texture);
  const hasColors = coloredVertices > 0 && coloredVertices >= positions.length / 3 * 0.9;
  // Culori 0–255 (unele exporturi) → 0–1
  if (hasColors && maxColor > 1.0001) for (let i = 0; i < colors.length; i++) colors[i] /= 255;
  if (hasColors) {
    for (let i = 0; i < colors.length; i++) {
      if (Number.isNaN(colors[i])) colors[i] = DEFAULT_MESH_COLOR[i % 3];
      else colors[i] = Math.min(1, Math.max(0, colors[i]));
    }
  }
  if (textured) notes.push({ code: 'textured-mesh', value: [...new Set(slots.map((s) => s.texture).filter(Boolean))].join(', ') });
  else if (hasColors) notes.push({ code: 'vertex-colors' });
  for (const m of missing) notes.push({ code: 'texture-missing', value: m });

  return analyzeMesh(
    {
      positions,
      faces,
      faceKinds,
      groups,
      faceGroups,
      render: triV.length >= 3 ? { uvs, colors: hasColors ? colors : null, triV, triT, triSlot, slots, textures } : undefined,
    },
    'obj',
    { ...opts, explicitUnit: unitHint(text), explicitUp: upHint(text), extraNotes: notes },
  );
}

// ── RoomPlan JSON ─────────────────────────────────────────────────────────────

type Mat4 = number[]; // column-major, 16 valori (convenția simd / ARKit)

interface Surface {
  w: number;
  h: number;
  m: Mat4;
  polygon?: Vec3[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function readMatrix(t: unknown): Mat4 | null {
  if (Array.isArray(t)) {
    if (t.length === 16 && t.every(isNum)) return t as number[];
    if (t.length === 4 && t.every((c) => Array.isArray(c) && c.length === 4 && c.every(isNum))) return (t as number[][]).flat();
  }
  return null;
}

const mulPoint = (m: Mat4, p: Vec3): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

function readSurfaces(list: unknown): Surface[] {
  if (!Array.isArray(list)) return [];
  const out: Surface[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const d = o.dimensions;
    const m = readMatrix(o.transform);
    if (!Array.isArray(d) || d.length < 2 || !isNum(d[0]) || !isNum(d[1]) || !m) continue;
    const polygon = Array.isArray(o.polygonCorners)
      ? (o.polygonCorners as unknown[]).filter((c): c is Vec3 => Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every(isNum)).map((c) => [c[0], c[1], c[2]] as Vec3)
      : undefined;
    out.push({ w: d[0], h: d[1], m, polygon: polygon && polygon.length >= 3 ? polygon : undefined });
  }
  return out;
}

function surfaceCorners(s: Surface): Vec3[] {
  const hw = s.w / 2, hh = s.h / 2;
  return ([[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]] as Vec3[]).map((p) => mulPoint(s.m, p));
}

/** Înlănțuie segmentele pereților într-un poligon închis (capete la ≤ 15 cm); null dacă nu se închide. */
function chainWalls(segs: [P2, P2][]): P2[] | null {
  if (segs.length < 3) return null;
  const tol = 0.15;
  const near = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const rest = segs.slice(1);
  const poly: P2[] = [segs[0][0], segs[0][1]];
  while (rest.length) {
    const tail = poly[poly.length - 1];
    const i = rest.findIndex(([a, b]) => near(a, tail) || near(b, tail));
    if (i < 0) return null;
    const [a, b] = rest.splice(i, 1)[0];
    poly.push(near(a, tail) ? b : a);
  }
  if (!near(poly[0], poly[poly.length - 1])) return null;
  poly.pop();
  return poly;
}

function lengthUnitFrom(x: unknown): LengthUnit | undefined {
  if (typeof x !== 'string') return undefined;
  const u = x.toLowerCase();
  if (u === 'mm' || u.startsWith('milli')) return 'mm';
  if (u === 'cm' || u.startsWith('centi')) return 'cm';
  if (u === 'in' || u.startsWith('inch')) return 'in';
  if (u === 'm' || u.startsWith('met')) return 'm';
  return undefined;
}

function countOf(x: unknown): number {
  if (Array.isArray(x)) return x.length;
  if (isNum(x)) return Math.max(0, Math.round(x));
  return 0;
}

export function parseRoomPlanJson(text: string, opts: ParseOptions = {}): RoomScan {
  if (!text.trim()) throw new ScanParseError('empty');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ScanParseError('invalid-json', e instanceof Error ? e.message : undefined);
  }
  if (!data || typeof data !== 'object') throw new ScanParseError('no-room');
  return parseRoomPlanObject(data as Record<string, unknown>, opts);
}

export function parseRoomPlanObject(root: Record<string, unknown>, opts: ParseOptions = {}): RoomScan {
  // CapturedStructure (iOS 17, mai multe camere): pereții sunt la rădăcină sau în `rooms[]`
  const rooms = Array.isArray(root.rooms) ? (root.rooms as Record<string, unknown>[]).filter((r) => r && typeof r === 'object') : [];
  const collect = (key: string) => {
    const own = readSurfaces(root[key]);
    if (own.length || !rooms.length) return own;
    return rooms.flatMap((r) => readSurfaces(r[key]));
  };
  const walls = collect('walls');

  if (walls.length === 0) return parseDimensionsObject(root, opts);

  const doors = collect('doors');
  const windows = collect('windows');
  const openings = collect('openings');
  const floors = collect('floors');
  const notes: ScanNote[] = [{ code: 'unit-explicit', value: 'm' }];

  // Cote în spațiul ARKit (metri, Y-sus)
  const wallCorners = walls.map(surfaceCorners);
  const plan: P2[] = wallCorners.flatMap((c) => c.map((p) => [p[0], p[2]] as P2));
  let floorY = Infinity, topY = -Infinity;
  for (const c of wallCorners) for (const p of c) {
    if (p[1] < floorY) floorY = p[1];
    if (p[1] > topY) topY = p[1];
  }
  const frame = minAreaRect(plan);
  if (Math.abs(Math.sin(frame.angle * 2)) > 0.02) notes.push({ code: 'rotated', value: Math.round((frame.angle * 180) / Math.PI) });
  const heightM = topY - floorY;

  const toLocal = (p: Vec3): Vec3 => {
    const px = p[0] - frame.origin[0], pz = p[2] - frame.origin[1];
    return [px * frame.u[0] + pz * frame.u[1], p[1] - floorY, px * frame.v[0] + pz * frame.v[1]];
  };

  // Aria podelei: poligonul podelei (iOS 17) → pereți înlănțuiți → dreptunghiul minim
  let floorAreaSqm = frame.length * frame.width;
  let floorPoly: P2[] | null = null;
  const fl = floors.find((f) => f.polygon) ?? null;
  if (fl?.polygon) {
    floorPoly = fl.polygon.map((p) => {
      const w = mulPoint(fl.m, p);
      return [w[0], w[2]] as P2;
    });
  } else {
    floorPoly = chainWalls(wallCorners.map((c) => [[c[0][0], c[0][2]], [c[1][0], c[1][2]]] as [P2, P2]));
  }
  if (floorPoly) {
    const a = shoelace(floorPoly);
    if (a > 0.3 * floorAreaSqm && a <= floorAreaSqm * 1.01) {
      floorAreaSqm = a;
      notes.push({ code: 'floor-from-polygon' });
    }
  }

  const edges: ScanEdge[] = [];
  const rectEdges = (corners: Vec3[], kind: EdgeKind) => {
    const c = corners.map(toLocal);
    for (let i = 0; i < c.length; i++) edges.push({ a: c[i], b: c[(i + 1) % c.length], kind });
  };
  wallCorners.forEach((c) => rectEdges(c, 'wall'));
  doors.forEach((s) => rectEdges(surfaceCorners(s), 'door'));
  windows.forEach((s) => rectEdges(surfaceCorners(s), 'window'));
  openings.forEach((s) => rectEdges(surfaceCorners(s), 'opening'));
  if (floorPoly) {
    const c = floorPoly.map((p) => toLocal([p[0], floorY, p[1]]));
    for (let i = 0; i < c.length; i++) edges.push({ a: c[i], b: c[(i + 1) % c.length], kind: 'floor' });
  } else {
    edges.push(...boxEdges(frame.length, frame.width, 0).filter((e) => e.kind === 'floor'));
  }

  const gross = walls.reduce((s, w) => s + w.w * w.h, 0);
  const holes = [...doors, ...windows, ...openings].reduce((s, o) => s + o.w * o.h, 0);
  const placed: ScanOpening[] = [];
  for (const [kind, list] of [['door', doors], ['window', windows], ['opening', openings]] as const) {
    for (const srf of list) {
      const o = openingFromPoints(kind, surfaceCorners(srf).map(toLocal), frame.length, frame.width, heightM);
      if (o) placed.push(o);
    }
  }

  return finalize({
    source: 'roomplan',
    fileName: opts.fileName,
    lengthM: frame.length,
    widthM: frame.width,
    heightM,
    floorAreaSqm,
    wallAreaGrossSqm: gross,
    wallAreaNetSqm: Math.max(0, gross - holes),
    volumeM3: floorAreaSqm * heightM,
    wallCount: walls.length,
    doorCount: doors.length,
    windowCount: windows.length,
    openingCount: openings.length,
    unit: 'm',
    upAxis: 'y',
    vertexCount: wallCorners.length * 4,
    faceCount: walls.length + doors.length + windows.length + openings.length,
    edges,
    cloud: [],
    openings: placed,
    notes,
  });
}

/** JSON simplu: `{ dimensions: { length, width, height } | [L, W, H], doors, windows, unit }`. */
function parseDimensionsObject(root: Record<string, unknown>, opts: ParseOptions): RoomScan {
  const d = root.dimensions ?? root.room ?? root;
  let L: unknown, W: unknown, H: unknown;
  if (Array.isArray(d)) [L, W, H] = d;
  else if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    L = o.length ?? o.lengthM ?? o.L;
    W = o.width ?? o.widthM ?? o.W;
    H = o.height ?? o.heightM ?? o.H;
  }
  if (!isNum(L) || !isNum(W) || !isNum(H) || L <= 0 || W <= 0 || H <= 0) throw new ScanParseError('no-room');
  const explicitUnit = opts.unit ?? lengthUnitFrom(root.unit ?? (d as Record<string, unknown>)?.unit);
  const det = detectUnitAndUp([L, H, W], { unit: explicitUnit, upAxis: 'y' });
  const s = UNIT_SCALE[det.unit];
  const lengthM = Math.max(L, W) * s, widthM = Math.min(L, W) * s, heightM = H * s;
  const doorCount = countOf(root.doors);
  const windowCount = countOf(root.windows);
  const openingCount = countOf(root.openings);
  const wallCount = countOf(root.walls) || 4;
  const gross = 2 * (lengthM + widthM) * heightM;
  const notes: ScanNote[] = [{ code: explicitUnit ? 'unit-explicit' : 'unit-detected', value: det.unit }];
  if (!det.plausible) notes.push({ code: 'implausible-size' });
  if (doorCount + windowCount > 0) notes.push({ code: 'openings-standard' });
  const floorAreaSqm = lengthM * widthM;
  return finalize({
    source: 'dimensions',
    fileName: opts.fileName,
    lengthM,
    widthM,
    heightM,
    floorAreaSqm,
    wallAreaGrossSqm: gross,
    wallAreaNetSqm: Math.max(0, gross - doorCount * STANDARD_DOOR_AREA - windowCount * STANDARD_WINDOW_AREA),
    volumeM3: floorAreaSqm * heightM,
    wallCount,
    doorCount,
    windowCount,
    openingCount,
    unit: det.unit,
    upAxis: 'y',
    vertexCount: 0,
    faceCount: 0,
    edges: boxEdges(lengthM, widthM, heightM),
    cloud: [],
    openings: [],
    notes,
  });
}

// ── USDZ (ZIP) + USDA ───────────────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  dataOffset: number;
}

/** Directorul central al unei arhive ZIP (USDZ = ZIP necomprimat, aliniat la 64 de octeți). */
export function readZipDirectory(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const len = buf.byteLength;
  if (len < 22) throw new ScanParseError('zip-invalid');
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ScanParseError('zip-invalid');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let k = 0; k < count && p + 46 <= len; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (local + 30 <= len && view.getUint32(local, true) === 0x04034b50) {
      const ln = view.getUint16(local + 26, true);
      const le = view.getUint16(local + 28, true);
      out.push({ name, method, compressedSize, size, dataOffset: local + 30 + ln + le });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!out.length) throw new ScanParseError('zip-invalid');
  return out;
}

async function readZipEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const raw = new Uint8Array(buf, e.dataOffset, Math.min(e.compressedSize, buf.byteLength - e.dataOffset));
  if (e.method === 0) return raw;
  if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new ScanParseError('zip-invalid', `method ${e.method}`);
}

// Matrice 4×4 în convenția USD (vector-rând: p' = p · M, translația pe ultimul rând)
type RowMat = number[];
const IDENTITY: RowMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function rowMul(a: RowMat, b: RowMat): RowMat {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = s;
  }
  return o;
}
const rowApply = (m: RowMat, p: Vec3): Vec3 => [
  p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
  p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
  p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14],
];
function quatMat(w: number, x: number, y: number, z: number): RowMat {
  // Rotația ca matrice pentru vector-rând (transpusa celei pentru vector-coloană)
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
function eulerMat(deg: Vec3): RowMat {
  const [ax, ay, az] = deg.map((d) => (d * Math.PI) / 180);
  const rx: RowMat = [1, 0, 0, 0, 0, Math.cos(ax), Math.sin(ax), 0, 0, -Math.sin(ax), Math.cos(ax), 0, 0, 0, 0, 1];
  const ry: RowMat = [Math.cos(ay), 0, -Math.sin(ay), 0, 0, 1, 0, 0, Math.sin(ay), 0, Math.cos(ay), 0, 0, 0, 0, 1];
  const rz: RowMat = [Math.cos(az), Math.sin(az), 0, 0, -Math.sin(az), Math.cos(az), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return rowMul(rowMul(rx, ry), rz); // rotateXYZ: X aplicat primul
}

const nums = (s: string) => (s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

interface UsdFrame {
  prim: string | null;
  kind: EdgeKind | null;
  /** Prim-ul de gol (Door0, Window1…) căruia îi aparține geometria, moștenit de copii. */
  group: string | null;
  parent: RowMat;
  local: { t: RowMat; r: RowMat; s: RowMat; m: RowMat };
  points: Vec3[];
  counts: number[];
  indices: number[];
  cubeSize: number | null;
}

export interface UsdaResult {
  mesh: MeshInput;
  metersPerUnit?: number;
  upAxis?: UpAxis;
}

/** Evaluator USDA minimal: ierarhia `def … { }`, xformOp (transform / translate / orient / rotateXYZ / scale), Mesh + Cube. */
export function evaluateUsda(text: string): UsdaResult {
  const positions: number[] = [];
  const faces: number[][] = [];
  const faceKinds: (EdgeKind | null)[] = [];
  const faceGroups: (string | null)[] = [];
  const groups = emptyGroups();
  let metersPerUnit: number | undefined;
  let upAxis: UpAxis | undefined;

  const token =
    /def\s+\w+\s+"([^"]*)"|(\{)|(\})|point3f\[\]\s+points\s*=\s*\[([^\]]*)\]|int\[\]\s+faceVertexCounts\s*=\s*\[([^\]]*)\]|int\[\]\s+faceVertexIndices\s*=\s*\[([^\]]*)\]|matrix4d\s+xformOp:transform(?::\w+)?\s*=\s*\(\s*((?:\([^)]*\)\s*,?\s*){4})\)|(?:double3|float3)\s+xformOp:translate(?::\w+)?\s*=\s*\(([^)]*)\)|(?:double3|float3|half3)\s+xformOp:scale(?::\w+)?\s*=\s*\(([^)]*)\)|(?:quatf|quatd|quath)\s+xformOp:orient(?::\w+)?\s*=\s*\(([^)]*)\)|(?:double3|float3)\s+xformOp:rotateXYZ(?::\w+)?\s*=\s*\(([^)]*)\)|double\s+size\s*=\s*(-?[\d.eE+-]+)|metersPerUnit\s*=\s*([\d.eE+-]+)|upAxis\s*=\s*"([YZyz])"/g;

  const root: UsdFrame = { prim: null, kind: null, group: null, parent: IDENTITY, local: { t: IDENTITY, r: IDENTITY, s: IDENTITY, m: IDENTITY }, points: [], counts: [], indices: [], cubeSize: null };
  const stack: UsdFrame[] = [root];
  let pendingPrim: string | null = null;
  const world = (f: UsdFrame) => rowMul(rowMul(rowMul(rowMul(f.local.s, f.local.r), f.local.m), f.local.t), f.parent);

  const closeFrame = (f: UsdFrame) => {
    const W = world(f);
    const pts = f.points.length ? f.points : f.cubeSize !== null ? cubeCorners(f.cubeSize) : [];
    if (!pts.length) return;
    const base = positions.length / 3;
    for (const p of pts) positions.push(...rowApply(W, p));
    if (f.points.length && f.counts.length && f.indices.length) {
      let k = 0;
      for (const c of f.counts) {
        const poly = f.indices.slice(k, k + c).map((i) => base + i).filter((i) => i < base + pts.length);
        k += c;
        if (poly.length >= 2) {
          faces.push(poly);
          faceKinds.push(f.kind);
          faceGroups.push(f.group);
        }
      }
    } else if (!f.points.length) {
      for (const q of CUBE_FACES) {
        faces.push(q.map((i) => base + i));
        faceKinds.push(f.kind);
        faceGroups.push(f.group);
      }
    }
  };

  let m: RegExpExecArray | null;
  while ((m = token.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      pendingPrim = m[1];
    } else if (m[2]) {
      const parentWorld = top === root ? IDENTITY : world(top);
      const prim = pendingPrim;
      pendingPrim = null;
      const kind = prim ? groupKind(prim) : top.kind;
      const isNewOpening = Boolean(prim && (kind === 'door' || kind === 'window' || kind === 'opening') && top.kind !== kind);
      if (prim && kind && kind !== 'floor' && kind !== 'mesh' && top.kind !== kind) groups[kind].add(prim);
      const group = isNewOpening ? prim : kind === top.kind ? top.group : null;
      // Un `{` fără `def` (ex. dicționar de metadate) moștenește transformarea părintelui
      stack.push(
        prim
          ? { prim, kind, group, parent: parentWorld, local: { t: IDENTITY, r: IDENTITY, s: IDENTITY, m: IDENTITY }, points: [], counts: [], indices: [], cubeSize: null }
          : { ...top, prim: null, points: [], counts: [], indices: [], cubeSize: null, parent: parentWorld, local: { t: IDENTITY, r: IDENTITY, s: IDENTITY, m: IDENTITY } },
      );
    } else if (m[3]) {
      if (stack.length > 1) {
        const f = stack.pop()!;
        if (f.prim) closeFrame(f);
      }
    } else if (m[4] !== undefined) {
      const v = nums(m[4]);
      for (let i = 0; i + 2 < v.length; i += 3) top.points.push([v[i], v[i + 1], v[i + 2]]);
    } else if (m[5] !== undefined) {
      top.counts = nums(m[5]);
    } else if (m[6] !== undefined) {
      top.indices = nums(m[6]);
    } else if (m[7] !== undefined) {
      const v = nums(m[7]);
      if (v.length === 16) top.local.m = v;
    } else if (m[8] !== undefined) {
      const v = nums(m[8]);
      if (v.length === 3) top.local.t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
    } else if (m[9] !== undefined) {
      const v = nums(m[9]);
      if (v.length === 3) top.local.s = [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1];
    } else if (m[10] !== undefined) {
      const v = nums(m[10]);
      if (v.length === 4) top.local.r = quatMat(v[0], v[1], v[2], v[3]);
    } else if (m[11] !== undefined) {
      const v = nums(m[11]);
      if (v.length === 3) top.local.r = eulerMat([v[0], v[1], v[2]]);
    } else if (m[12] !== undefined) {
      top.cubeSize = Number(m[12]);
    } else if (m[13] !== undefined) {
      metersPerUnit = Number(m[13]);
    } else if (m[14] !== undefined) {
      upAxis = m[14].toLowerCase() as UpAxis;
    }
  }
  while (stack.length > 1) {
    const f = stack.pop()!;
    if (f.prim) closeFrame(f);
  }
  return { mesh: { positions, faces, faceKinds, groups, faceGroups }, metersPerUnit, upAxis };
}

const CUBE_FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
function cubeCorners(size: number): Vec3[] {
  const h = size / 2;
  return [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]];
}

function unitFromMetersPerUnit(mpu: number | undefined): LengthUnit | undefined {
  if (!mpu || !Number.isFinite(mpu)) return undefined;
  if (Math.abs(mpu - 1) < 1e-6) return 'm';
  if (Math.abs(mpu - 0.01) < 1e-6) return 'cm';
  if (Math.abs(mpu - 0.001) < 1e-6) return 'mm';
  if (Math.abs(mpu - 0.0254) < 1e-6) return 'in';
  return undefined;
}

export function parseUsda(text: string, opts: ParseOptions = {}, extraNotes: ScanNote[] = []): RoomScan {
  const r = evaluateUsda(text);
  if (r.mesh.positions.length < 12) throw new ScanParseError('no-vertices');
  return analyzeMesh(r.mesh, 'usdz', {
    ...opts,
    explicitUnit: unitFromMetersPerUnit(r.metersPerUnit),
    explicitUp: r.upAxis,
    extraNotes,
  });
}

export async function parseUsdz(buf: ArrayBuffer, opts: ParseOptions = {}): Promise<RoomScan> {
  if (buf.byteLength === 0) throw new ScanParseError('empty');
  const entries = readZipDirectory(buf);
  const dec = new TextDecoder();
  // 1. Un JSON RoomPlan inclus în pachet (unele aplicații îl adaugă alături de modelul 3D)
  for (const e of entries.filter((x) => /\.json$/i.test(x.name))) {
    try {
      const scan = parseRoomPlanJson(dec.decode(await readZipEntry(buf, e)), opts);
      return { ...scan, source: 'usdz', fileName: opts.fileName, notes: [{ code: 'json-entry', value: e.name }, ...scan.notes] };
    } catch {
      /* încercăm intrarea următoare */
    }
  }
  // 2. Straturi USDA (ASCII)
  for (const e of entries.filter((x) => /\.usda$/i.test(x.name))) {
    try {
      return parseUsda(dec.decode(await readZipEntry(buf, e)), opts, [{ code: 'usda-entry', value: e.name }]);
    } catch {
      /* încercăm intrarea următoare */
    }
  }
  // 3. Un .usd / .usdc care este de fapt text (USD permite ambele codificări sub extensia .usd)
  for (const e of entries.filter((x) => /\.usdc?$/i.test(x.name))) {
    const data = await readZipEntry(buf, e);
    const head = dec.decode(data.subarray(0, 8));
    if (head.startsWith('#usda')) return parseUsda(dec.decode(data), opts, [{ code: 'usda-entry', value: e.name }]);
  }
  // 4. Crate binar: nu ghicim cote. Raportăm ce prim-uri RoomPlan se văd (dacă tabela de tokeni e necomprimată).
  const crate = entries.find((x) => /\.usdc?$/i.test(x.name));
  if (crate) {
    const data = await readZipEntry(buf, crate);
    const latin = new TextDecoder('latin1').decode(data);
    const names = new Set(latin.match(/\b(?:Wall|Door|Window|Opening)\d+\b/g) ?? []);
    const count = (p: string) => [...names].filter((n) => n.startsWith(p)).length;
    throw new ScanParseError(
      'usdz-binary',
      names.size ? `walls=${count('Wall')} doors=${count('Door')} windows=${count('Window')}` : undefined,
    );
  }
  throw new ScanParseError('usdz-empty');
}

// ── Dispecer după extensie ─────────────────────────────────────────────────

export const ACCEPTED_SCAN_EXTENSIONS = ['.obj', '.usdz', '.usda', '.json', '.zip'] as const;
/** Fișiere acceptate doar împreună cu un .obj (selecție multiplă): materialele și texturile. */
export const ACCEPTED_COMPANION_EXTENSIONS = ['.mtl', '.jpg', '.jpeg', '.png', '.webp'] as const;

export interface ScanFileLike {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export async function parseScanFile(file: ScanFileLike, opts: ParseOptions = {}): Promise<RoomScan> {
  const name = file.name.toLowerCase();
  const o = { ...opts, fileName: file.name };
  const buf = await file.arrayBuffer();
  if (name.endsWith('.usdz')) return parseUsdz(buf, o);
  if (name.endsWith('.zip')) return parseScanZip(buf, o);
  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.obj')) return parseObj(text, o);
  if (name.endsWith('.usda')) return parseUsda(text, o);
  if (name.endsWith('.json')) return parseRoomPlanJson(text, o);
  throw new ScanParseError('unsupported', file.name);
}

/** Adaugă un fișier însoțitor (.mtl / imagine) la resursele unui OBJ. */
function addAsset(assets: Required<ObjAssets>, name: string, data: Uint8Array) {
  const base = baseName(name);
  if (/\.mtl$/i.test(base)) assets.mtl.push({ name: base, text: new TextDecoder().decode(data) });
  else {
    const mime = textureMime(base);
    if (mime) assets.textures.push({ name: base, mime, data });
  }
}

/**
 * Arhivă ZIP de scanare (Scaniverse / Polycam / 3D Scanner App): OBJ-ul cel mai mare + .mtl + texturile din arhivă.
 * Fără OBJ: JSON RoomPlan / USDA inclus (aceeași logică ca USDZ).
 */
export async function parseScanZip(buf: ArrayBuffer, opts: ParseOptions = {}): Promise<RoomScan> {
  if (buf.byteLength === 0) throw new ScanParseError('empty');
  const entries = readZipDirectory(buf).filter((e) => !e.name.endsWith('/') && !/(^|\/)__MACOSX\//.test(e.name) && !/(^|\/)\._/.test(e.name));
  const obj = entries.filter((e) => /\.obj$/i.test(e.name)).sort((a, b) => b.size - a.size)[0];
  if (obj) {
    const assets: Required<ObjAssets> = { mtl: [], textures: [] };
    for (const e of entries) {
      if (e === obj || !/\.(mtl|jpe?g|png|webp)$/i.test(e.name)) continue;
      addAsset(assets, e.name, await readZipEntry(buf, e));
    }
    const text = new TextDecoder().decode(await readZipEntry(buf, obj));
    return parseObj(text, opts, assets, [{ code: 'zip-entry', value: obj.name }]);
  }
  if (entries.some((e) => /\.(json|usda|usdc?)$/i.test(e.name))) return parseUsdz(buf, opts);
  throw new ScanParseError('zip-no-model');
}

/**
 * Selecție multiplă / plasare simultană: o arhivă .zip, un .obj cu .mtl + texturi alături, sau un singur fișier de
 * scanare (aceeași cale ca `parseScanFile`).
 */
export async function parseScanFiles(files: ScanFileLike[], opts: ParseOptions = {}): Promise<RoomScan> {
  if (!files.length) throw new ScanParseError('empty');
  const lower = (f: ScanFileLike) => f.name.toLowerCase();
  const zip = files.find((f) => lower(f).endsWith('.zip'));
  if (zip) return parseScanFile(zip, opts);
  const obj = files.find((f) => lower(f).endsWith('.obj'));
  if (obj) {
    const assets: Required<ObjAssets> = { mtl: [], textures: [] };
    for (const f of files) {
      if (f === obj || !ACCEPTED_COMPANION_EXTENSIONS.some((ext) => lower(f).endsWith(ext))) continue;
      addAsset(assets, f.name, new Uint8Array(await f.arrayBuffer()));
    }
    const text = new TextDecoder().decode(await obj.arrayBuffer());
    return parseObj(text, { ...opts, fileName: obj.name }, assets);
  }
  const main = files.find((f) => ACCEPTED_SCAN_EXTENSIONS.some((ext) => lower(f).endsWith(ext)));
  if (!main) throw new ScanParseError('unsupported', files.map((f) => f.name).join(', '));
  return parseScanFile(main, opts);
}

// ── Scanarea demo: living 4,85 × 3,90 × 2,65 m (format RoomPlan CapturedRoom) ──

/**
 * O cameră reală ca structură: 5 pereți (peretele lung e împărțit în două segmente, ca în RoomPlan),
 * o ușă, două ferestre, podea poligonală; rotită 14° și cu podeaua la −1,32 m (originea ARKit e la telefon).
 */
export function buildDemoRoomPlan(): Record<string, unknown> {
  const L = 4.85, W = 3.9, H = 2.65, floorY = -1.32;
  const yaw = (14 * Math.PI) / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Rotația în jurul lui Y aplicată unui punct din planul camerei (x de-a lungul lungimii, z de-a lungul lățimii)
  const rot = (x: number, z: number): [number, number] => [x * c + z * s, -x * s + z * c];
  /** Suprafață verticală: centrul (x, y, z) în cadrul camerei, direcția peretelui = unghi față de axa lungimii. */
  const surface = (cx: number, cy: number, cz: number, dirAngle: number, w: number, h: number, id: string, category: Record<string, unknown>) => {
    const a = dirAngle - yaw; // direcția în spațiul ARKit
    const ux = Math.cos(a), uz = Math.sin(a);
    // normala orizontală (spre interior nu contează pentru cote)
    const nx = -uz, nz = ux;
    const [px, pz] = rot(cx, cz);
    return {
      identifier: id,
      category,
      confidence: { high: {} },
      dimensions: [w, h, 0],
      // simd_float4x4 column-major: col0 = direcția peretelui, col1 = sus, col2 = normala, col3 = poziția
      transform: [ux, 0, uz, 0, 0, 1, 0, 0, nx, 0, nz, 0, px, floorY + cy, pz, 1],
    };
  };
  return {
    version: 2,
    identifier: 'SUCVAR-DEMO-LIVING-4.85x3.90x2.65',
    walls: [
      surface(1.2, H / 2, 0, 0, 2.4, H, 'wall-0a', { wall: {} }),
      surface(2.4 + 2.45 / 2, H / 2, 0, 0, 2.45, H, 'wall-0b', { wall: {} }),
      surface(L, H / 2, W / 2, Math.PI / 2, W, H, 'wall-1', { wall: {} }),
      surface(L / 2, H / 2, W, Math.PI, L, H, 'wall-2', { wall: {} }),
      surface(0, H / 2, W / 2, -Math.PI / 2, W, H, 'wall-3', { wall: {} }),
    ],
    doors: [surface(0, 2.1 / 2, 0.75, -Math.PI / 2, 0.9, 2.1, 'door-0', { door: { isOpen: false } })],
    windows: [
      surface(2.1, 0.85 + 1.5 / 2, W, Math.PI, 1.4, 1.5, 'window-0', { window: {} }),
      surface(L, 0.9 + 1.4 / 2, 2.05, Math.PI / 2, 1.2, 1.4, 'window-1', { window: {} }),
    ],
    openings: [],
    objects: [],
    floors: [
      {
        identifier: 'floor-0',
        category: { floor: {} },
        confidence: { high: {} },
        dimensions: [L, W, 0],
        // Podeaua: plan local x–y, rotit orizontal (local y → −z_lume după rotație), centrat
        polygonCorners: [[-L / 2, -W / 2, 0], [L / 2, -W / 2, 0], [L / 2, W / 2, 0], [-L / 2, W / 2, 0]],
        transform: (() => {
          const [px, pz] = rot(L / 2, W / 2);
          // col0 = axa lungimii, col1 = axa lățimii (în plan), col2 = sus
          return [c, 0, -s, 0, s, 0, c, 0, 0, 1, 0, 0, px, floorY, pz, 1];
        })(),
      },
    ],
  };
}

export function loadDemoScan(): RoomScan {
  const scan = parseRoomPlanObject(buildDemoRoomPlan(), { fileName: 'sucvar-demo-living.json' });
  return { ...scan, source: 'demo' };
}

// ── Rezumatul aplicat în Studio / B2B ──────────────────────────────────────

export interface RoomMeasurement {
  lengthM: number;
  widthM: number;
  heightM: number;
  areaSqm: number;
  volumeM3: number;
  wallAreaSqm: number;
  doors?: number;
  windows?: number;
  source: ScanSource | 'photo';
}

export function measurementFromScan(scan: RoomScan): RoomMeasurement {
  const hasOpenings = scan.source === 'roomplan' || scan.source === 'demo' || scan.doorCount + scan.windowCount > 0;
  return {
    lengthM: scan.lengthM,
    widthM: scan.widthM,
    heightM: scan.heightM,
    areaSqm: scan.floorAreaSqm,
    volumeM3: scan.volumeM3,
    wallAreaSqm: scan.wallAreaNetSqm,
    doors: hasOpenings ? scan.doorCount : undefined,
    windows: hasOpenings ? scan.windowCount : undefined,
    source: scan.source,
  };
}
