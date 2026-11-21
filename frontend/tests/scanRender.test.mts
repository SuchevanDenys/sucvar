// tests/scanRender.test.mts — `pnpm test` (node --test, fără dependențe).
// Perspectiva interioară a scanării („Proiect scanat 3D”): camera, scena proiectată și exportul PNG 1280 × 800.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDemoScan, parseObj, parseRoomPlanJson, type RoomScan } from '../app/lib/studio/lidarParser.ts';
import {
  EYE_HEIGHT_M,
  STUDIO_SCAN_SIZE,
  buildInteriorScene,
  cameraYaw,
  defaultCameraAngle,
  polygonArea,
  renderScanToStudioImage,
  resolveInteriorCamera,
  type CanvasLike,
  type Ctx2D,
  type ScanCameraAngle,
} from '../app/lib/studio/scanRender.ts';

// ── Canvas fals: înregistrează apelurile și „exportă” un PNG real (semnătura PNG + IHDR cu mărimea canvas-ului) ──

function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function fakeCanvas() {
  const calls = { fill: 0, stroke: 0, fillRect: 0, moveTo: 0, lineTo: 0, fills: new Set<string>(), exportType: '' };
  const ctx: Ctx2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); calls.moveTo++; },
    lineTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); calls.lineTo++; },
    fill() { calls.fill++; calls.fills.add(String(this.fillStyle)); },
    stroke() { calls.stroke++; },
    fillRect() { calls.fillRect++; },
    setLineDash() {},
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL(type) {
      calls.exportType = type ?? '';
      return pngDataUrl(this.width, this.height);
    },
  };
  return { canvas, calls };
}

/** Lățimea / înălțimea din antetul IHDR al unui `data:image/png;base64,…`. */
function pngSize(url: string): { width: number; height: number } {
  assert.ok(url.startsWith('data:image/png;base64,'), 'data URL PNG');
  const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'semnătura PNG');
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// ── Scanări de test ──

/** Cameră OBJ 5,00 × 4,00 × 2,70 m (Y-sus, metri), cu o ușă și o fereastră ca grupuri (export RoomPlan → OBJ). */
function objRoom(): string {
  const L = 5, W = 4, H = 2.7;
  const lines = ['# RoomPlan export', 'o Floor0'];
  const v: [number, number, number][] = [];
  const quad = (pts: [number, number, number][]) => {
    const base = v.length;
    v.push(...pts);
    for (const p of pts) lines.push(`v ${p.join(' ')}`);
    lines.push(`f ${base + 1} ${base + 2} ${base + 3} ${base + 4}`);
  };
  quad([[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]]);
  lines.push('o Wall0');
  quad([[0, 0, 0], [L, 0, 0], [L, H, 0], [0, H, 0]]);
  lines.push('o Wall1');
  quad([[L, 0, 0], [L, 0, W], [L, H, W], [L, H, 0]]);
  lines.push('o Wall2');
  quad([[0, 0, W], [L, 0, W], [L, H, W], [0, H, W]]);
  lines.push('o Wall3');
  quad([[0, 0, 0], [0, 0, W], [0, H, W], [0, H, 0]]);
  lines.push('o Door0');
  quad([[0.01, 0, 1.0], [0.01, 0, 1.9], [0.01, 2.05, 1.9], [0.01, 2.05, 1.0]]);
  lines.push('o Window0');
  quad([[1.8, 0.9, W - 0.01], [3.2, 0.9, W - 0.01], [3.2, 2.3, W - 0.01], [1.8, 2.3, W - 0.01]]);
  return lines.join('\n');
}

const SCANS: [string, () => RoomScan][] = [
  ['demo RoomPlan', () => loadDemoScan()],
  ['OBJ', () => parseObj(objRoom(), { fileName: 'room.obj' })],
  ['RoomPlan JSON (dimensiuni)', () => parseRoomPlanJson(JSON.stringify({ dimensions: { length: 4.2, width: 3.1, height: 2.55 }, doors: 1, windows: 1 }))],
];
const ANGLES: ScanCameraAngle[] = [{ preset: 'entry' }, { preset: 'window' }, { preset: 'custom', yaw: 0.7 }, { preset: 'custom', yaw: -2.4 }];

// ── Golurile din parser ──

test('demo: ușa și cele două ferestre au poziția exactă pe pereți', () => {
  const s = loadDemoScan();
  assert.deepEqual(s.openings.map((o) => [o.kind, o.wall]), [['door', 3], ['window', 2], ['window', 1]]);
  const [door, w0, w1] = s.openings;
  assert.deepEqual([door.u0, door.u1, door.y0, door.y1], [0.3, 1.2, 0, 2.1]);
  assert.deepEqual([w0.u0, w0.u1, w0.y0, w0.y1], [1.4, 2.8, 0.85, 2.35]);
  assert.deepEqual([w1.u0, w1.u1, w1.y0, w1.y1], [1.45, 2.65, 0.9, 2.3]);
  assert.ok(s.openings.every((o) => !o.estimated));
});

test('OBJ: golurile vin din grupurile Door* / Window*', () => {
  const s = parseObj(objRoom());
  assert.equal(s.doorCount, 1);
  assert.equal(s.windowCount, 1);
  const door = s.openings.find((o) => o.kind === 'door');
  const win = s.openings.find((o) => o.kind === 'window');
  assert.ok(door && win);
  assert.equal(door.estimated, undefined);
  assert.ok(Math.abs(door.u1 - door.u0 - 0.9) < 0.02 && Math.abs(door.y1 - 2.05) < 0.02, JSON.stringify(door));
  assert.ok(Math.abs(win.u1 - win.u0 - 1.4) < 0.02 && Math.abs(win.y0 - 0.9) < 0.02, JSON.stringify(win));
});

test('JSON cu dimensiuni: golurile sunt sintetizate în poziții standard, marcate „estimated”', () => {
  const s = parseRoomPlanJson(JSON.stringify({ dimensions: [5, 4, 2.7], doors: 1, windows: 3 }));
  assert.equal(s.openings.filter((o) => o.kind === 'door').length, 1);
  assert.equal(s.openings.filter((o) => o.kind === 'window').length, 3);
  for (const o of s.openings) {
    assert.equal(o.estimated, true);
    const span = o.wall === 0 || o.wall === 2 ? s.lengthM : s.widthM;
    assert.ok(o.u0 >= 0 && o.u1 <= span && o.u1 > o.u0 && o.y1 <= s.heightM && o.y1 > o.y0, JSON.stringify(o));
  }
});

// ── Camera ──

test('camera interioară: la 1,45 m, în interiorul camerei, privire orizontală', () => {
  for (const [name, make] of SCANS) {
    const s = make();
    for (const a of ANGLES) {
      const cam = resolveInteriorCamera(s, a);
      const [x, y, z] = cam.eye;
      assert.ok(x > 0 && x < s.lengthM && z > 0 && z < s.widthM, `${name} ${a.preset}: ochiul în cameră ${cam.eye}`);
      assert.equal(y, Math.min(EYE_HEIGHT_M, s.heightM - 0.2));
      assert.equal(cam.target[1], y, 'verticalele rămân verticale');
    }
  }
});

test('„Spre fereastră” privește peretele cu cele mai multe ferestre; „Colț intrare” stă lângă ușă', () => {
  const s = loadDemoScan();
  const win = resolveInteriorCamera(s, { preset: 'window' });
  // Fereastra mare (1,40 × 1,50 m) e pe peretele 2 (z = l): privirea merge spre +z
  assert.ok(win.target[2] > win.eye[2] && Math.abs(win.target[0] - win.eye[0]) < 1e-9);
  const entry = resolveInteriorCamera(s, { preset: 'entry' });
  // Ușa e pe peretele x = 0, lângă z = 0 → colțul (0, 0), privire pe diagonală spre (L, l)
  assert.ok(entry.eye[0] < 1 && entry.eye[2] < 1);
  assert.ok(entry.target[0] > s.lengthM - 0.01 && entry.target[2] > s.widthM - 0.01);
  assert.deepEqual(defaultCameraAngle(s), { preset: 'window' });
});

test('unghiul utilizatorului urmează direcția orbitei', () => {
  const s = loadDemoScan();
  for (const yaw of [0, 0.7, -1.2, 2.9]) {
    const got = cameraYaw(resolveInteriorCamera(s, { preset: 'custom', yaw }));
    const diff = Math.atan2(Math.sin(got - yaw), Math.cos(got - yaw));
    assert.ok(Math.abs(diff) < 1e-9, `yaw ${yaw} → ${got}`);
  }
});

// ── Scena ──

test('scena acoperă tot cadrul (podea + tavan + pereți = 1280 × 800) pentru fiecare scanare și unghi', () => {
  for (const [name, make] of SCANS) {
    const s = make();
    for (const a of ANGLES) {
      const scene = buildInteriorScene(s, a);
      const room = scene.polygons.filter((p) => p.kind === 'floor' || p.kind === 'ceiling' || p.kind === 'wall');
      const area = room.reduce((sum, p) => sum + polygonArea(p.points), 0);
      const frame = STUDIO_SCAN_SIZE.width * STUDIO_SCAN_SIZE.height;
      assert.ok(Math.abs(area / frame - 1) < 0.002, `${name} ${a.preset}/${a.yaw ?? ''}: acoperire ${area / frame}`);
      for (const p of scene.polygons) {
        for (const [x, y] of p.points) assert.ok(x >= -1e-6 && x <= 1280 + 1e-6 && y >= -1e-6 && y <= 800 + 1e-6, `${name}: punct în afara cadrului`);
      }
      const kinds = new Set(scene.polygons.map((p) => p.kind));
      assert.ok(kinds.has('floor') && kinds.has('ceiling') && kinds.has('wall'), `${name} ${a.preset}: ${[...kinds]}`);
      // Podeaua jos, tavanul sus (privire orizontală, orizontul la 40 % din înălțime)
      const cy = (kind: string) => {
        const ps = scene.polygons.filter((p) => p.kind === kind).flatMap((p) => p.points);
        return ps.reduce((t, q) => t + q[1], 0) / ps.length;
      };
      assert.ok(cy('floor') > 320 && cy('ceiling') < 320, `${name} ${a.preset}: podea ${cy('floor')}, tavan ${cy('ceiling')}`);
      // Structura (bordo), grila și reperele metrice sunt prezente
      const lineKinds = new Set(scene.lines.map((l) => l.kind));
      for (const k of ['structure', 'ceiling', 'grid', 'tick']) assert.ok(lineKinds.has(k as never), `${name} ${a.preset}: lipsește ${k}`);
    }
  }
});

test('ferestrele și ușa se văd ca goluri distincte (ramă, montanți, pervaz, mâner)', () => {
  const s = loadDemoScan();
  const win = buildInteriorScene(s, { preset: 'window' });
  assert.ok(win.visibleOpenings.some((o) => o.kind === 'window'));
  assert.ok(win.polygons.some((p) => p.kind === 'window'));
  assert.ok(win.lines.some((l) => l.kind === 'mullion') && win.lines.some((l) => l.kind === 'sill'));
  // Privind înapoi spre intrare (de la peretele cu fereastra din dreapta), ușa e în cadru
  const back = buildInteriorScene(s, { preset: 'custom', yaw: -2.4 });
  assert.ok(back.visibleOpenings.some((o) => o.kind === 'door'), JSON.stringify(back.visibleOpenings));
  assert.ok(back.polygons.some((p) => p.kind === 'door') && back.lines.some((l) => l.kind === 'handle'));
  // Culorile diferențiază planele: podea, pereți, tavan, fereastră, ușă
  const fills = new Set([...win.polygons, ...back.polygons].map((p) => `${p.kind}:${p.fill}`));
  const byKind = (k: string) => [...fills].filter((f) => f.startsWith(`${k}:`)).map((f) => f.split(':')[1]);
  const fl = byKind('floor')[0], ce = byKind('ceiling')[0], wi = byKind('window')[0], dr = byKind('door')[0];
  assert.equal(new Set([fl, ce, wi, dr, ...byKind('wall')]).size >= 5, true);
});

// ── Exportul ──

test('renderScanToStudioImage: PNG valid 1280 × 800 pentru fiecare scanare și unghi', () => {
  for (const [name, make] of SCANS) {
    const s = make();
    for (const a of ANGLES) {
      const { canvas, calls } = fakeCanvas();
      const url = renderScanToStudioImage(s, a, { canvas });
      assert.equal(calls.exportType, 'image/png');
      assert.deepEqual(pngSize(url), { width: 1280, height: 800 }, `${name} ${a.preset}`);
      assert.equal(calls.fillRect, 1, 'fundalul');
      assert.ok(calls.fill >= 4, `${name} ${a.preset}: ${calls.fill} plane umplute (podea, tavan, ≥ 2 pereți)`);
      assert.ok(calls.stroke > 20 && calls.lineTo > calls.fill, `${name} ${a.preset}: wireframe desenat`);
    }
  }
});

test('renderScanToStudioImage: aceeași scenă la alt format, eroare clară fără canvas', () => {
  const { canvas } = fakeCanvas();
  assert.deepEqual(pngSize(renderScanToStudioImage(loadDemoScan(), { preset: 'entry' }, { canvas, width: 640, height: 400 })), { width: 640, height: 400 });
  assert.throws(() => renderScanToStudioImage(loadDemoScan(), { preset: 'entry' }), /no canvas available/);
  const broken: CanvasLike = { width: 0, height: 0, getContext: () => null, toDataURL: () => '' };
  assert.throws(() => renderScanToStudioImage(loadDemoScan(), { preset: 'entry' }, { canvas: broken }), /2D context unavailable/);
});

// ── Plasa reală (WebGL): camerele vizualizatorului texturat ─────────────────

import {
  HORIZON_RATIO,
  defaultOrbitView,
  interiorMeshView,
  meshCamera,
  meshViewAngle,
  meshViewProjection,
  projectMeshPoint,
} from '../app/lib/studio/scanRender.ts';

test('mesh · „Unghi interior 1 / 2” = aceleași camere ca perspectiva schematică', () => {
  const scan = loadDemoScan();
  for (const preset of ['entry', 'window'] as const) {
    const v = interiorMeshView(scan, { preset });
    const cam = resolveInteriorCamera(scan, { preset });
    assert.deepEqual(v.eye, cam.eye);
    assert.equal(v.kind, 'interior');
    assert.ok(Math.abs(v.yaw - cameraYaw(cam)) < 1e-12);
    assert.deepEqual(meshViewAngle(v), { preset });
  }
  assert.deepEqual(meshViewAngle({ ...interiorMeshView(scan, { preset: 'entry' }), preset: 'custom', yaw: 1.2 }), { preset: 'custom', yaw: 1.2 });
});

test('mesh · proiecția interioară: ținta la centru pe orizontală, orizontul la 40 %, dreapta = înainte × sus', () => {
  const scan = loadDemoScan();
  const { width: w, height: h } = STUDIO_SCAN_SIZE;
  const v = interiorMeshView(scan, { preset: 'window' });
  const cam = meshCamera(v, scan, w / h);
  const m = meshViewProjection(cam, w / h);
  const f: [number, number, number] = [Math.sin(v.yaw), 0, Math.cos(v.yaw)];
  const ahead = projectMeshPoint(m, [v.eye[0] + f[0] * 2, v.eye[1], v.eye[2] + f[2] * 2], w, h)!;
  assert.ok(Math.abs(ahead[0] - w / 2) < 1e-3 && Math.abs(ahead[1] - h * HORIZON_RATIO) < 1e-3, `ținta la ${ahead}`);
  // Dreapta: cross(f, sus) = (−f.z, 0, f.x)
  const right = projectMeshPoint(m, [v.eye[0] + f[0] * 2 - f[2] * 0.5, v.eye[1], v.eye[2] + f[2] * 2 + f[0] * 0.5], w, h)!;
  assert.ok(right[0] > w / 2 + 50);
  // Câmpul vizual orizontal de 78°: un punct la 39° spre dreapta cade pe marginea cadrului
  const a = (39 * Math.PI) / 180;
  const edge = projectMeshPoint(m, [v.eye[0] + f[0] * Math.cos(a) * 3 - f[2] * Math.sin(a) * 3, v.eye[1], v.eye[2] + f[2] * Math.cos(a) * 3 + f[0] * Math.sin(a) * 3], w, h)!;
  assert.ok(Math.abs(edge[0] - w) < 1, `margine la ${edge[0]}`);
  // În spatele camerei: null
  assert.equal(projectMeshPoint(m, [v.eye[0] - f[0], v.eye[1], v.eye[2] - f[2]], w, h), null);
});

test('mesh · „Vedere ansamblu”: toată camera în cadru, privire de sus, zoom apropie', () => {
  for (const scan of [loadDemoScan(), parseRoomPlanJson(JSON.stringify({ dimensions: [9.5, 3, 3.2] }))]) {
    for (const aspect of [1.6, 0.75]) {
      const w = 1000, h = Math.round(1000 / aspect);
      const v = defaultOrbitView();
      const cam = meshCamera(v, scan, aspect);
      assert.ok(cam.eye[1] > scan.heightM, 'ochiul deasupra camerei');
      const m = meshViewProjection(cam, aspect);
      const L = scan.lengthM, W = scan.widthM, H = scan.heightM;
      for (const c of [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W], [0, H, 0], [L, H, 0], [L, H, W], [0, H, W]] as [number, number, number][]) {
        const p = projectMeshPoint(m, c, w, h);
        assert.ok(p && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h, `colț ${c} în afara cadrului: ${p}`);
      }
      const closer = meshCamera({ ...v, zoom: 2 }, scan, aspect);
      const d = (e: number[]) => Math.hypot(e[0] - L / 2, e[1] - H / 2, e[2] - W / 2);
      assert.ok(Math.abs(d(closer.eye) * 2 - d(cam.eye)) < 1e-9);
    }
  }
});
