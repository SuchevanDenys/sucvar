// app/lib/studio/scanRender.ts
// „Proiect scanat 3D (LiDAR)” — perspectiva interioară a scanării, la nivelul ochilor (~1,45 m), ca sursă Studio.
//
//   • `resolveInteriorCamera` — presetări: „Unghi 1 · Colț intrare” (din colțul ușii, pe diagonală), „Unghi 2 · Spre
//     fereastră” (de lângă peretele opus, spre peretele cu cele mai multe ferestre) și unghiul ales de utilizator
//     (direcția din orbita 3D, cu ochiul retras lângă peretele din spate).
//   • `buildInteriorScene` — geometrie PURĂ: planele podelei, tavanului și pereților (umbrite Lambert, lumina vine
//     dinspre ferestre), golurile pe pereți, muchiile structurale (bordo), grila podelei de 0,5 m și repere metrice
//     (fără text: modelul AI ar copia cifrele în fotografie). Poligoanele sunt decupate la planul apropiat și la cadru.
//   • `drawInteriorScene` / `renderScanToStudioImage` — desen pe <canvas> 2D (fără WebGL / biblioteci), export
//     PNG 1280 × 800 (`data:image/png;base64,…`).
//
// Paleta exportului e mereu cea luminoasă: imaginea trimisă modelului e aceeași indiferent de tema interfeței
// (o fotografie nu are „dark mode”), iar previzualizarea arată exact ce primește modelul.
//
// Modul este PUR (doar importuri de tip), ca testele `node --test` să-l încarce direct.

import type { RoomScan, ScanOpening, Vec3, WallIndex } from './lidarParser';

export type ScanCameraPreset = 'entry' | 'window' | 'custom';

export interface ScanCameraAngle {
  preset: ScanCameraPreset;
  /** Direcția privirii pentru `custom` (radiani, aceeași convenție ca orbita: înainte = (sin, 0, cos)). */
  yaw?: number;
}

export interface InteriorCamera {
  eye: Vec3;
  target: Vec3;
  /** Câmpul vizual orizontal (grade): ~78° ≈ obiectiv de 18–20 mm, tipic fotografiei de interior. */
  hfovDeg: number;
}

export const STUDIO_SCAN_SIZE = { width: 1280, height: 800 } as const;
export const EYE_HEIGHT_M = 1.45;
const HFOV_DEG = 78;
const NEAR = 0.05;
/**
 * Orizontul la 40 % din înălțimea cadrului: descentrare verticală ca la un obiectiv shift — verticalele rămân drepte,
 * dar podeaua intră în cadru și în camerele puțin adânci (la 50 % ar apărea abia de la ~2,9 m de cameră).
 */
export const HORIZON_RATIO = 0.4;

type P2 = [number, number];
type SurfaceKind = 'floor' | 'ceiling' | 'wall' | 'door' | 'window' | 'opening';
type LineKind = 'structure' | 'ceiling' | 'grid' | 'tick' | 'frame' | 'mullion' | 'sill' | 'handle';

export interface ScenePolygon {
  kind: SurfaceKind;
  wall?: WallIndex;
  fill: string;
  /** Puncte în pixeli, deja decupate la cadru. */
  points: P2[];
}

export interface SceneLine {
  kind: LineKind;
  a: P2;
  b: P2;
  color: string;
  width: number;
  dash?: number[];
}

export interface InteriorScene {
  width: number;
  height: number;
  camera: InteriorCamera;
  polygons: ScenePolygon[];
  lines: SceneLine[];
  /** Golurile cu cel puțin o parte în cadru. */
  visibleOpenings: ScanOpening[];
}

// ── Paleta (identitatea SUCVAR, varianta luminoasă) ──────────────────────────

export const SCAN_PALETTE = {
  bg: '#FAF8F6',
  floor: '#E4DCD3',
  ceiling: '#FBFAF8',
  wallLit: [246, 243, 239] as const,
  wallShade: [226, 219, 212] as const,
  door: '#CDBBA8',
  window: '#D6E3EA',
  opening: '#D9D1C9',
  structure: '#5C1628',
  ceilingLine: 'rgba(92,22,40,0.55)',
  grid: 'rgba(92,22,40,0.09)',
  tick: 'rgba(92,22,40,0.5)',
  frame: '#A67C52',
} as const;

// ── Vectori ─────────────────────────────────────────────────────────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Normala spre interior a fiecărui perete. */
const WALL_NORMAL: Record<WallIndex, Vec3> = { 0: [0, 0, 1], 1: [-1, 0, 0], 2: [0, 0, -1], 3: [1, 0, 0] };

/** Punctul 3D al coordonatelor (u de-a lungul peretelui, y) pe peretele `wall`. */
export function wallPoint(wall: WallIndex, u: number, y: number, L: number, W: number): Vec3 {
  switch (wall) {
    case 0: return [u, y, 0];
    case 1: return [L, y, u];
    case 2: return [u, y, W];
    case 3: return [0, y, u];
  }
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** Peretele spre care merge „Spre fereastră”: cea mai mare suprafață vitrată (altfel peretele lung din spate). */
export function windowWall(scan: RoomScan): WallIndex {
  const area = new Map<WallIndex, number>();
  for (const o of scan.openings) {
    if (o.kind !== 'window') continue;
    area.set(o.wall, (area.get(o.wall) ?? 0) + (o.u1 - o.u0) * (o.y1 - o.y0));
  }
  let best: WallIndex = 2;
  let max = 0;
  for (const [wall, a] of area) if (a > max) [best, max] = [wall, a];
  return best;
}

/** Colțul (x, z) cel mai apropiat de ușa principală (altfel originea). */
function entryCorner(scan: RoomScan): [number, number] {
  const L = scan.lengthM, W = scan.widthM;
  const door = scan.openings.find((o) => o.kind === 'door') ?? scan.openings.find((o) => o.kind === 'opening');
  if (!door) return [0, 0];
  const mid = (door.u0 + door.u1) / 2;
  const p = wallPoint(door.wall, mid, 0, L, W);
  const corners: [number, number][] = [[0, 0], [L, 0], [L, W], [0, W]];
  return corners.reduce((best, c) => (Math.hypot(c[0] - p[0], c[1] - p[2]) < Math.hypot(best[0] - p[0], best[1] - p[2]) ? c : best));
}

export function resolveInteriorCamera(scan: RoomScan, angle: ScanCameraAngle): InteriorCamera {
  const L = Math.max(0.5, scan.lengthM), W = Math.max(0.5, scan.widthM), H = Math.max(1.8, scan.heightM);
  const eyeY = Math.min(EYE_HEIGHT_M, H - 0.2);
  // Privire orizontală (ca un obiectiv tilt-shift): verticalele rămân perfect verticale, orizontul la mijlocul cadrului
  const lookY = eyeY;
  const inset = Math.min(0.45, 0.15 * Math.min(L, W));

  if (angle.preset === 'entry') {
    const [cx, cz] = entryCorner(scan);
    const ex = cx === 0 ? inset : L - inset;
    const ez = cz === 0 ? inset : W - inset;
    return { eye: [ex, eyeY, ez], target: [L - cx, lookY, W - cz], hfovDeg: HFOV_DEG };
  }

  if (angle.preset === 'window') {
    const wall = windowWall(scan);
    const n = WALL_NORMAL[wall];
    // Ochiul lângă peretele opus, centrat; ținta = centrul peretelui cu ferestre
    const span = wall === 0 || wall === 2 ? L : W;
    const target = wallPoint(wall, span / 2, lookY, L, W);
    const depth = wall === 0 || wall === 2 ? W : L;
    const back = Math.max(inset, depth - Math.min(0.4, depth * 0.12));
    return { eye: [target[0] + n[0] * back, eyeY, target[2] + n[2] * back], target, hfovDeg: HFOV_DEG };
  }

  // Unghiul utilizatorului: direcția orbitei; ochiul pe raza din spate, retras lângă perete
  const yaw = angle.yaw ?? 0;
  const f: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const c: Vec3 = [L / 2, eyeY, W / 2];
  const exit = (pos: number, dir: number, lo: number, hi: number) => (Math.abs(dir) < 1e-9 ? Infinity : dir > 0 ? (hi - pos) / dir : (lo - pos) / dir);
  const tBack = Math.min(exit(c[0], -f[0], 0, L), exit(c[2], -f[2], 0, W));
  const t = Math.max(0, tBack - inset);
  const eye: Vec3 = [c[0] - f[0] * t, eyeY, c[2] - f[2] * t];
  return { eye, target: [eye[0] + f[0] * 3, lookY, eye[2] + f[2] * 3], hfovDeg: HFOV_DEG };
}

/** Direcția orizontală a privirii (radiani, convenția orbitei) — punctul de plecare pentru rotirea manuală. */
export function cameraYaw(cam: InteriorCamera): number {
  return Math.atan2(cam.target[0] - cam.eye[0], cam.target[2] - cam.eye[2]);
}

// ── Proiecție + decupare ────────────────────────────────────────────────────

interface Projector {
  toCam: (p: Vec3) => Vec3;
  project: (c: Vec3) => P2;
}

function makeProjector(cam: InteriorCamera, width: number, height: number): Projector {
  const f = norm(sub(cam.target, cam.eye));
  // Sistem drept: dreapta = f × sus (privind spre +z cu y în sus, +x este la stânga)
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const focal = width / 2 / Math.tan((cam.hfovDeg * Math.PI) / 360);
  return {
    toCam: (p) => {
      const d = sub(p, cam.eye);
      return [dot(d, r), dot(d, u), dot(d, f)];
    },
    project: (c) => [width / 2 + (c[0] * focal) / c[2], height * HORIZON_RATIO - (c[1] * focal) / c[2]],
  };
}

/** Sutherland–Hodgman la planul apropiat (z ≥ NEAR), în spațiul camerei. */
function clipNear(poly: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a[2] >= NEAR, inb = b[2] >= NEAR;
    if (ina) out.push(a);
    if (ina !== inb) out.push(lerp3(a, b, (NEAR - a[2]) / (b[2] - a[2])));
  }
  return out;
}

/** Sutherland–Hodgman la dreptunghiul cadrului (pixeli). */
function clipRect(poly: P2[], w: number, h: number): P2[] {
  const edges: [(p: P2) => boolean, (a: P2, b: P2) => P2][] = [
    [(p) => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= w, (a, b) => { const t = (w - a[0]) / (b[0] - a[0]); return [w, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, 0]; }],
    [(p) => p[1] <= h, (a, b) => { const t = (h - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, h]; }],
  ];
  let cur = poly;
  for (const [inside, cut] of edges) {
    if (!cur.length) break;
    const next: P2[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      const ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    cur = next;
  }
  return cur;
}

export function polygonArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

const rgb = (c: readonly [number, number, number]) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const mix = (a: readonly number[], b: readonly number[], t: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as [number, number, number];

// ── Scena ───────────────────────────────────────────────────────────────────

export function buildInteriorScene(
  scan: RoomScan,
  angle: ScanCameraAngle,
  width: number = STUDIO_SCAN_SIZE.width,
  height: number = STUDIO_SCAN_SIZE.height,
): InteriorScene {
  const L = Math.max(0.5, scan.lengthM), W = Math.max(0.5, scan.widthM), H = Math.max(1.8, scan.heightM);
  const camera = resolveInteriorCamera(scan, angle);
  const P = makeProjector(camera, width, height);
  const polygons: ScenePolygon[] = [];
  const lines: SceneLine[] = [];

  const addPoly = (kind: SurfaceKind, pts: Vec3[], fill: string, wall?: WallIndex): boolean => {
    const cam = clipNear(pts.map(P.toCam));
    if (cam.length < 3) return false;
    const screen = clipRect(cam.map(P.project), width, height);
    if (screen.length < 3 || polygonArea(screen) < 0.5) return false;
    polygons.push({ kind, wall, fill, points: screen });
    return true;
  };
  const addLine = (kind: LineKind, a: Vec3, b: Vec3, color: string, w: number, dash?: number[]) => {
    let ca = P.toCam(a), cb = P.toCam(b);
    if (ca[2] < NEAR && cb[2] < NEAR) return;
    if (ca[2] < NEAR) ca = lerp3(ca, cb, (NEAR - ca[2]) / (cb[2] - ca[2]));
    else if (cb[2] < NEAR) cb = lerp3(cb, ca, (NEAR - cb[2]) / (ca[2] - cb[2]));
    lines.push({ kind, a: P.project(ca), b: P.project(cb), color, width: w, dash });
  };

  // 1. Plane: podea, tavan, pereți (lumina intră prin peretele cu ferestre: peretele opus e cel mai luminos)
  addPoly('floor', [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]], SCAN_PALETTE.floor);
  addPoly('ceiling', [[0, H, 0], [0, H, W], [L, H, W], [L, H, 0]], SCAN_PALETTE.ceiling);
  const lightWall = windowWall(scan);
  const toLight: Vec3 = WALL_NORMAL[lightWall].map((v) => -v) as Vec3;
  for (const wall of [0, 1, 2, 3] as WallIndex[]) {
    const span = wall === 0 || wall === 2 ? L : W;
    // Lambert: peretele opus ferestrelor (normala spre lumină) e cel mai luminos, peretele cu ferestre e în contra-lumină
    const k = 0.5 + 0.5 * dot(WALL_NORMAL[wall], toLight);
    const fill = rgb(mix(SCAN_PALETTE.wallShade, SCAN_PALETTE.wallLit, Math.max(0, Math.min(1, k))));
    addPoly('wall', [wallPoint(wall, 0, 0, L, W), wallPoint(wall, span, 0, L, W), wallPoint(wall, span, H, L, W), wallPoint(wall, 0, H, L, W)], fill, wall);
  }

  // 2. Grila podelei (0,5 m) — repere de perspectivă și de scară
  for (let x = 0.5; x < L - 1e-6; x += 0.5) addLine('grid', [x, 0, 0], [x, 0, W], SCAN_PALETTE.grid, 1);
  for (let z = 0.5; z < W - 1e-6; z += 0.5) addLine('grid', [0, 0, z], [L, 0, z], SCAN_PALETTE.grid, 1);

  // 3. Golurile (deasupra pereților; din interiorul unei camere convexe suprafețele nu se suprapun pe ecran)
  const visibleOpenings: ScanOpening[] = [];
  for (const o of scan.openings) {
    const n = WALL_NORMAL[o.wall];
    const lift = (p: Vec3): Vec3 => [p[0] + n[0] * 0.004, p[1], p[2] + n[2] * 0.004];
    const q = (u: number, y: number) => lift(wallPoint(o.wall, u, y, L, W));
    const corners = [q(o.u0, o.y0), q(o.u1, o.y0), q(o.u1, o.y1), q(o.u0, o.y1)];
    const fill = o.kind === 'door' ? SCAN_PALETTE.door : o.kind === 'window' ? SCAN_PALETTE.window : SCAN_PALETTE.opening;
    if (!addPoly(o.kind, corners, fill, o.wall)) continue;
    visibleOpenings.push(o);
    const dash = o.kind === 'opening' ? [6, 4] : undefined;
    for (let i = 0; i < 4; i++) addLine('frame', corners[i], corners[(i + 1) % 4], SCAN_PALETTE.frame, o.kind === 'door' ? 3 : 2.5, dash);
    if (o.kind === 'window') {
      const mu = (o.u0 + o.u1) / 2, my = o.y0 + (o.y1 - o.y0) * 0.62;
      addLine('mullion', q(mu, o.y0), q(mu, o.y1), SCAN_PALETTE.frame, 1.5);
      addLine('mullion', q(o.u0, my), q(o.u1, my), SCAN_PALETTE.frame, 1.5);
      // Pervaz: ușor ieșit în cameră
      const out = (p: Vec3): Vec3 => [p[0] + n[0] * 0.12, p[1], p[2] + n[2] * 0.12];
      addLine('sill', out(q(o.u0 - 0.05, o.y0)), out(q(o.u1 + 0.05, o.y0)), SCAN_PALETTE.frame, 2);
    } else if (o.kind === 'door') {
      const hu = o.u0 + (o.u1 - o.u0) * 0.86;
      addLine('handle', q(hu, 1.0), q(hu, 1.08), SCAN_PALETTE.structure, 3);
    }
  }

  // 4. Structura: perimetrul podelei, muchiile verticale, conturul tavanului
  const corners: Vec3[] = [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    addLine('structure', a, b, SCAN_PALETTE.structure, 2.2);
    addLine('structure', a, [a[0], H, a[2]], SCAN_PALETTE.structure, 1.8);
    addLine('ceiling', [a[0], H, a[2]], [b[0], H, b[2]], SCAN_PALETTE.ceilingLine, 1.6);
  }

  // 5. Repere metrice: semne la fiecare metru pe plinte și la fiecare 0,5 m pe colțuri (fără text)
  for (const wall of [0, 1, 2, 3] as WallIndex[]) {
    const span = wall === 0 || wall === 2 ? L : W;
    for (let u = 1; u < span - 0.2; u += 1) addLine('tick', wallPoint(wall, u, 0, L, W), wallPoint(wall, u, 0.1, L, W), SCAN_PALETTE.tick, 1.4);
  }
  for (const c of corners) {
    for (let y = 0.5; y < H - 0.2; y += 0.5) {
      const dx = c[0] === 0 ? 0.08 : -0.08, dz = c[2] === 0 ? 0.08 : -0.08;
      addLine('tick', [c[0], y, c[2]], [c[0] + dx, y, c[2] + dz], SCAN_PALETTE.tick, 1.2);
    }
  }

  return { width, height, camera, polygons, lines, visibleOpenings };
}

// ── Desen pe canvas ─────────────────────────────────────────────────────────

/** Subsetul Canvas 2D folosit (orice CanvasRenderingContext2D îl satisface; testele folosesc un context fals). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D | null;
  toDataURL(type?: string): string;
}

/** Desenează scena în contextul dat (coordonate CSS; apelantul setează transformarea DPR). */
export function drawInteriorScene(ctx: Ctx2D, scene: InteriorScene): void {
  ctx.save();
  ctx.fillStyle = SCAN_PALETTE.bg;
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const poly of scene.polygons) {
    ctx.beginPath();
    poly.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = poly.fill;
    ctx.fill();
    // Contur de 1 px în aceeași culoare: ascunde firele de anti-aliasing dintre plane vecine
    ctx.strokeStyle = poly.fill;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of scene.lines) {
    ctx.beginPath();
    ctx.setLineDash(l.dash ?? []);
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width;
    ctx.moveTo(l.a[0], l.a[1]);
    ctx.lineTo(l.b[0], l.b[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Randează perspectiva interioară a scanării ca imagine-sursă Studio: PNG 1280 × 800 (`data:image/png;base64,…`).
 * `canvas` e opțional (implicit un <canvas> nou din `document`); testele trec un canvas fals.
 */
export function renderScanToStudioImage(
  scan: RoomScan,
  cameraAngle: ScanCameraAngle,
  opts: { canvas?: CanvasLike; width?: number; height?: number } = {},
): string {
  const width = opts.width ?? STUDIO_SCAN_SIZE.width;
  const height = opts.height ?? STUDIO_SCAN_SIZE.height;
  const canvas: CanvasLike | null = opts.canvas ?? (typeof document !== 'undefined' ? (document.createElement('canvas') as unknown as CanvasLike) : null);
  if (!canvas) throw new Error('renderScanToStudioImage: no canvas available');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('renderScanToStudioImage: 2D context unavailable');
  drawInteriorScene(ctx, buildInteriorScene(scan, cameraAngle, width, height));
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png;base64,')) throw new Error('renderScanToStudioImage: PNG export failed');
  return url;
}

/** Eticheta presetării (RO / EN / FR) — aceeași în fereastra LiDAR și în Studio. */
export function cameraPresetLabel(preset: ScanCameraPreset, t: (ro: string, en: string, fr?: string) => string): string {
  switch (preset) {
    case 'entry': return t('Unghi 1 · Colț intrare', 'Angle 1 · Entry corner', 'Angle 1 · Coin d’entrée');
    case 'window': return t('Unghi 2 · Spre fereastră', 'Angle 2 · Towards the window', 'Angle 2 · Vers la fenêtre');
    case 'custom': return t('Unghi 3 · Unghiul tău', 'Angle 3 · Your angle', 'Angle 3 · Votre angle');
  }
}

/** Presetarea implicită: spre fereastră când scanarea are ferestre, altfel din colțul intrării. */
export function defaultCameraAngle(scan: RoomScan): ScanCameraAngle {
  return { preset: scan.openings.some((o) => o.kind === 'window') ? 'window' : 'entry' };
}

// ── Plasa reală (WebGL): camerele vizualizatorului texturat ─────────────────
//
// Două moduri, aceeași convenție de unghi ca orbita schematică (înainte = (sin yaw, 0, cos yaw)):
//   • `orbit` — „Vedere ansamblu”: ochiul pe o sferă în jurul centrului camerei, privind în jos (`pitch` > 0).
//   • `interior` — „Unghi interior 1 / 2” / unghiul tău: ochiul la 1,45 m (aceleași camere ca `resolveInteriorCamera`),
//     privirea rotită cu `yaw` / `pitch`, obiectiv descentrat (orizontul la 40 % din cadru) ca exportul schematic.

export type MeshViewPreset = 'overview' | ScanCameraPreset;

export interface MeshView {
  kind: 'orbit' | 'interior';
  preset: MeshViewPreset;
  /** Direcția privirii (radiani). */
  yaw: number;
  /** orbit: înclinarea în jos; interior: privirea în sus (+) / jos (−). */
  pitch: number;
  /** orbit: apropiere (1 = camera întreagă în cadru). */
  zoom: number;
  /** interior: poziția ochiului (cadrul camerei, metri). */
  eye: Vec3;
  /** interior: câmpul vizual orizontal (grade). */
  hfovDeg: number;
}

export const ORBIT_PITCH = { min: 0.05, max: 1.45 } as const;
export const INTERIOR_PITCH = { min: -1.1, max: 1.1 } as const;
export const ORBIT_ZOOM = { min: 0.45, max: 4 } as const;
export const INTERIOR_HFOV = { min: 40, max: 100 } as const;
const ORBIT_VFOV_DEG = 42;

export function defaultOrbitView(): MeshView {
  return { kind: 'orbit', preset: 'overview', yaw: Math.PI / 4 + 0.12, pitch: 0.62, zoom: 1, eye: [0, 0, 0], hfovDeg: HFOV_DEG };
}

/** Vederea interioară a presetării (aceeași poziție a ochiului ca imaginea schematică). */
export function interiorMeshView(scan: RoomScan, angle: ScanCameraAngle): MeshView {
  const cam = resolveInteriorCamera(scan, angle);
  return { kind: 'interior', preset: angle.preset, yaw: cameraYaw(cam), pitch: 0, zoom: 1, eye: cam.eye, hfovDeg: cam.hfovDeg };
}

/** Unghiul schematic echivalent (pentru eticheta Studio și pentru rezerva fără WebGL). */
export function meshViewAngle(view: MeshView): ScanCameraAngle {
  return view.kind === 'interior' && view.preset !== 'overview' && view.preset !== 'custom' && view.pitch === 0
    ? { preset: view.preset }
    : { preset: 'custom', yaw: view.yaw };
}

export interface MeshCamera {
  eye: Vec3;
  target: Vec3;
  /** Câmpul vizual vertical (radiani). */
  fovY: number;
  near: number;
  far: number;
  /** Descentrarea verticală în NDC (+0,2 = orizontul la 40 % de sus). */
  shiftY: number;
}

export function meshCamera(view: MeshView, scan: RoomScan, aspect: number): MeshCamera {
  const L = Math.max(0.5, scan.lengthM), W = Math.max(0.5, scan.widthM), H = Math.max(1, scan.heightM);
  const a = Math.max(0.1, aspect);
  if (view.kind === 'interior') {
    const cp = Math.cos(view.pitch);
    const f: Vec3 = [Math.sin(view.yaw) * cp, Math.sin(view.pitch), Math.cos(view.yaw) * cp];
    const tanX = Math.tan((view.hfovDeg * Math.PI) / 360);
    return {
      eye: view.eye,
      target: [view.eye[0] + f[0], view.eye[1] + f[1], view.eye[2] + f[2]],
      fovY: 2 * Math.atan(tanX / a),
      near: 0.03,
      far: Math.hypot(L, W, H) * 3 + 10,
      shiftY: 1 - 2 * HORIZON_RATIO,
    };
  }
  const center: Vec3 = [L / 2, H / 2, W / 2];
  const radius = Math.hypot(L, W, H) / 2;
  const fovY = (ORBIT_VFOV_DEG * Math.PI) / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * a);
  const dist = (radius * 1.08) / Math.sin(Math.min(fovY, fovX) / 2) / Math.max(0.05, view.zoom);
  const cp = Math.cos(view.pitch);
  const f: Vec3 = [Math.sin(view.yaw) * cp, -Math.sin(view.pitch), Math.cos(view.yaw) * cp];
  return {
    eye: [center[0] - f[0] * dist, center[1] - f[1] * dist, center[2] - f[2] * dist],
    target: center,
    fovY,
    near: Math.max(0.03, dist - radius * 2.5),
    far: dist + radius * 3,
    shiftY: 0,
  };
}

/** Matricea vedere × proiecție (column-major, convenția WebGL), sistem drept: dreapta = înainte × sus. */
export function meshViewProjection(cam: MeshCamera, aspect: number): Float32Array {
  const f = norm(sub(cam.target, cam.eye));
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const e = cam.eye;
  // Vederea: rândurile r, u, −f; translația −(r·e, u·e, −f·e)
  const v = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, e), -dot(u, e), dot(f, e), 1,
  ];
  const t = 1 / Math.tan(cam.fovY / 2);
  const { near: n, far: fa } = cam;
  const p = [
    t / Math.max(0.1, aspect), 0, 0, 0,
    0, t, 0, 0,
    0, -cam.shiftY, (fa + n) / (n - fa), -1,
    0, 0, (2 * fa * n) / (n - fa), 0,
  ];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += p[k * 4 + rr] * v[c * 4 + k];
      out[c * 4 + rr] = s;
    }
  }
  return out;
}

/** Punctul 3D → pixeli (x, y) + adâncimea (w); null în spatele camerei. */
export function projectMeshPoint(m: Float32Array, p: Vec3, width: number, height: number): [number, number, number] | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 0.03) return null;
  return [((x / w + 1) / 2) * width, ((1 - y / w) / 2) * height, w];
}

/** Eticheta presetărilor vizualizatorului texturat (RO / EN / FR). */
export function meshPresetLabel(preset: MeshViewPreset, t: (ro: string, en: string, fr?: string) => string): string {
  switch (preset) {
    case 'overview': return t('Vedere ansamblu', 'Overview', 'Vue d’ensemble');
    case 'entry': return t('Unghi interior 1', 'Interior angle 1', 'Angle intérieur 1');
    case 'window': return t('Unghi interior 2', 'Interior angle 2', 'Angle intérieur 2');
    case 'custom': return t('Unghiul tău', 'Your angle', 'Votre angle');
  }
}
