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
  | 'json-entry';

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
  notes: ScanNote[];
}

export type ScanErrorCode =
  | 'empty'
  | 'unsupported'
  | 'no-vertices'
  | 'invalid-json'
  | 'no-room'
  | 'zip-invalid'
  | 'usdz-binary'
  | 'usdz-empty';

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
    notes,
  });
}

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

function finalize(scan: RoomScan): RoomScan {
  return {
    ...scan,
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

export function parseObj(text: string, opts: ParseOptions = {}): RoomScan {
  if (!text.trim()) throw new ScanParseError('empty');
  const positions: number[] = [];
  const faces: number[][] = [];
  const faceKinds: (EdgeKind | null)[] = [];
  const groups = emptyGroups();
  let currentKind: EdgeKind | null = null;

  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const c0 = text.charCodeAt(start);
    // Linii relevante: „v ”, „f ”, „o ”, „g ” (restul — vn, vt, usemtl, comentarii — sunt ignorate)
    if (c0 === 118 /* v */ && (text.charCodeAt(start + 1) === 32 || text.charCodeAt(start + 1) === 9)) {
      const parts = text.slice(start + 2, end).trim().split(/\s+/);
      const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) positions.push(x, y, z);
    } else if (c0 === 102 /* f */ && (text.charCodeAt(start + 1) === 32 || text.charCodeAt(start + 1) === 9)) {
      const parts = text.slice(start + 2, end).trim().split(/\s+/);
      const count = positions.length / 3;
      const poly: number[] = [];
      for (const p of parts) {
        const raw = parseInt(p, 10); // „12/5/7” → 12
        if (!Number.isFinite(raw) || raw === 0) continue;
        const idx = raw > 0 ? raw - 1 : count + raw;
        if (idx >= 0 && idx < count) poly.push(idx);
      }
      if (poly.length >= 2) {
        faces.push(poly);
        faceKinds.push(currentKind);
      }
    } else if ((c0 === 111 /* o */ || c0 === 103 /* g */) && text.charCodeAt(start + 1) === 32) {
      const name = text.slice(start + 2, end).trim();
      currentKind = groupKind(name);
      if (currentKind && currentKind !== 'floor' && currentKind !== 'mesh') groups[currentKind].add(name);
    }
    start = end + 1;
  }
  if (positions.length < 12) throw new ScanParseError('no-vertices');
  return analyzeMesh({ positions, faces, faceKinds, groups }, 'obj', {
    ...opts,
    explicitUnit: unitHint(text),
    explicitUp: upHint(text),
  });
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
  const groups = emptyGroups();
  let metersPerUnit: number | undefined;
  let upAxis: UpAxis | undefined;

  const token =
    /def\s+\w+\s+"([^"]*)"|(\{)|(\})|point3f\[\]\s+points\s*=\s*\[([^\]]*)\]|int\[\]\s+faceVertexCounts\s*=\s*\[([^\]]*)\]|int\[\]\s+faceVertexIndices\s*=\s*\[([^\]]*)\]|matrix4d\s+xformOp:transform(?::\w+)?\s*=\s*\(\s*((?:\([^)]*\)\s*,?\s*){4})\)|(?:double3|float3)\s+xformOp:translate(?::\w+)?\s*=\s*\(([^)]*)\)|(?:double3|float3|half3)\s+xformOp:scale(?::\w+)?\s*=\s*\(([^)]*)\)|(?:quatf|quatd|quath)\s+xformOp:orient(?::\w+)?\s*=\s*\(([^)]*)\)|(?:double3|float3)\s+xformOp:rotateXYZ(?::\w+)?\s*=\s*\(([^)]*)\)|double\s+size\s*=\s*(-?[\d.eE+-]+)|metersPerUnit\s*=\s*([\d.eE+-]+)|upAxis\s*=\s*"([YZyz])"/g;

  const root: UsdFrame = { prim: null, kind: null, parent: IDENTITY, local: { t: IDENTITY, r: IDENTITY, s: IDENTITY, m: IDENTITY }, points: [], counts: [], indices: [], cubeSize: null };
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
        }
      }
    } else if (!f.points.length) {
      for (const q of CUBE_FACES) {
        faces.push(q.map((i) => base + i));
        faceKinds.push(f.kind);
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
      if (prim && kind && kind !== 'floor' && kind !== 'mesh' && top.kind !== kind) groups[kind].add(prim);
      // Un `{` fără `def` (ex. dicționar de metadate) moștenește transformarea părintelui
      stack.push(
        prim
          ? { prim, kind, parent: parentWorld, local: { t: IDENTITY, r: IDENTITY, s: IDENTITY, m: IDENTITY }, points: [], counts: [], indices: [], cubeSize: null }
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
  return { mesh: { positions, faces, faceKinds, groups }, metersPerUnit, upAxis };
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

export const ACCEPTED_SCAN_EXTENSIONS = ['.obj', '.usdz', '.usda', '.json'] as const;

export async function parseScanFile(
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> },
  opts: ParseOptions = {},
): Promise<RoomScan> {
  const name = file.name.toLowerCase();
  const o = { ...opts, fileName: file.name };
  const buf = await file.arrayBuffer();
  if (name.endsWith('.usdz')) return parseUsdz(buf, o);
  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.obj')) return parseObj(text, o);
  if (name.endsWith('.usda')) return parseUsda(text, o);
  if (name.endsWith('.json')) return parseRoomPlanJson(text, o);
  throw new ScanParseError('unsupported', file.name);
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
