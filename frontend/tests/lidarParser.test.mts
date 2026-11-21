// tests/lidarParser.test.ts — `pnpm test` (node --test, fără dependențe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ScanParseError,
  buildDemoRoomPlan,
  detectUnitAndUp,
  loadDemoScan,
  measurementFromScan,
  minAreaRect,
  parseObj,
  parseRoomPlanJson,
  parseScanFile,
  parseUsda,
  parseUsdz,
  readZipDirectory,
} from '../app/lib/studio/lidarParser.ts';

const close = (actual: number, expected: number, tol = 0.011, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);

type V = [number, number, number];

/** O cameră ca plasă OBJ (Y-sus, metri): cutia camerei pe grupuri + o canapea pe podea. */
function roomObj(
  { L = 4.85, W = 3.9, H = 2.65, scale = 1, zUp = false, yawDeg = 0, header = '' } = {},
): string {
  const yaw = (yawDeg * Math.PI) / 180;
  const tf = ([x, y, z]: V): V => {
    const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
    const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
    // Z-sus: (x, y, z)_Ysus → (x, −z, y)
    const p: V = zUp ? [rx, -rz, y] : [rx, y, rz];
    return [p[0] * scale, p[1] * scale, p[2] * scale];
  };
  const lines: string[] = [header, '# SUCVAR test room'];
  let base = 1;
  const box = (name: string, [x0, y0, z0]: V, [x1, y1, z1]: V, faces: number[][]) => {
    lines.push(`o ${name}`);
    const c: V[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    for (const p of c) lines.push(`v ${tf(p).map((n) => n.toFixed(5)).join(' ')}`);
    for (const f of faces) lines.push(`f ${f.map((i) => `${base + i}/${base + i}/${base + i}`).join(' ')}`);
    base += 8;
  };
  const ALL = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  box('Floor0', [0, 0, 0], [L, H, W], [[0, 3, 2, 1].reverse()]); // podeaua, normala în sus
  box('Wall0', [0, 0, 0], [L, H, W], ALL.slice(1));
  box('Sofa', [1, 0, 0.4], [3, 0.8, 1.3], ALL);
  box('Door0', [0, 0, 0.5], [0.02, 2.1, 1.4], ALL);
  box('Window0', [2, 0.9, W - 0.02], [3.4, 2.4, W], ALL);
  return lines.join('\n');
}

test('OBJ · Y-sus, metri: cote exacte din cutia camerei', () => {
  const s = parseObj(roomObj());
  close(s.lengthM, 4.85);
  close(s.widthM, 3.9);
  close(s.heightM, 2.65);
  close(s.floorAreaSqm, 18.92);
  close(s.volumeM3, 50.12, 0.05);
  assert.equal(s.unit, 'm');
  assert.equal(s.upAxis, 'y');
  assert.equal(s.doorCount, 1);
  assert.equal(s.windowCount, 1);
  close(s.wallAreaGrossSqm, 46.38, 0.02);
  close(s.wallAreaNetSqm, 46.375 - 1.89 - 2.1, 0.02);
  assert.ok(s.edges.length > 12, 'wireframe edges');
  assert.ok(s.edges.every((e) => [...e.a, ...e.b].every(Number.isFinite)));
});

test('OBJ · detectarea unităților (cm, mm, inch)', () => {
  for (const [unit, scale] of [['cm', 100], ['mm', 1000], ['in', 1 / 0.0254]] as const) {
    const s = parseObj(roomObj({ scale }));
    assert.equal(s.unit, unit);
    close(s.lengthM, 4.85, 0.02, unit);
    close(s.widthM, 3.9, 0.02, unit);
    close(s.heightM, 2.65, 0.02, unit);
  }
});

test('OBJ · Z-sus: detectat când Y nu poate fi înălțime, prin comentariu sau forțat', () => {
  // Plan 10 × 9 m: o „înălțime” de 9 m pe Y e imposibilă ⇒ Z-sus
  const auto = parseObj(roomObj({ zUp: true, L: 10, W: 9 }));
  assert.equal(auto.upAxis, 'z');
  close(auto.heightM, 2.65);
  close(auto.lengthM, 10);
  close(auto.widthM, 9);
  // Cameră obișnuită Z-sus: ambiguă geometric ⇒ Y implicit + notă, apoi comentariul / opțiunea decid
  const ambiguous = parseObj(roomObj({ zUp: true }));
  assert.equal(ambiguous.upAxis, 'y');
  assert.ok(ambiguous.notes.some((n) => n.code === 'up-fallback'));
  const hinted = parseObj(roomObj({ zUp: true, header: '# up_axis: Z' }));
  assert.equal(hinted.upAxis, 'z');
  close(hinted.heightM, 2.65);
  close(hinted.widthM, 3.9);
  const forced = parseObj(roomObj({ zUp: true }), { upAxis: 'z' });
  assert.equal(forced.upAxis, 'z');
  close(forced.floorAreaSqm, 18.92);
});

test('OBJ · cameră rotită: dreptunghiul de arie minimă păstrează cotele', () => {
  const s = parseObj(roomObj({ yawDeg: 33 }));
  close(s.lengthM, 4.85);
  close(s.widthM, 3.9);
  assert.ok(s.notes.some((n) => n.code === 'rotated'));
});

test('OBJ · indici negativi, fără fețe (nor de puncte), erori', () => {
  const pts = 'v 0 0 0\nv 5 0 0\nv 5 0 4\nv 0 0 4\nv 0 2.5 0\nv 5 2.5 4\nf -6 -5 -4\n';
  const s = parseObj(pts);
  close(s.lengthM, 5);
  close(s.widthM, 4);
  close(s.heightM, 2.5);
  assert.throws(() => parseObj(''), (e: unknown) => e instanceof ScanParseError && e.code === 'empty');
  assert.throws(() => parseObj('v 1 2 3\n'), (e: unknown) => e instanceof ScanParseError && e.code === 'no-vertices');
  // Plase degenerate: puncte suprapuse / doar podeaua → respinse, niciodată cote de 0 m
  const isDegenerate = (e: unknown) => e instanceof ScanParseError && e.code === 'degenerate';
  assert.throws(() => parseObj('v 1 1 1\nv 1 1 1\nv 1 1 1\nv 1 1 1\nf 1 2 3\n'), isDegenerate);
  assert.throws(() => parseObj('v 0 0 0\nv 4 0 0\nv 4 0 3\nv 0 0 3\nf 1 2 3 4\n'), isDegenerate);
});

test('detectUnitAndUp · reguli de plauzibilitate', () => {
  assert.deepEqual(detectUnitAndUp([485, 265, 390]).unit, 'cm');
  assert.equal(detectUnitAndUp([4.85, 3.9, 2.65]).upAxis, 'y'); // ambele plauzibile → Y (convenția ARKit)
  assert.equal(detectUnitAndUp([4.85, 9.0, 2.65]).upAxis, 'z');
  assert.equal(detectUnitAndUp([0.01, 0.01, 0.01]).plausible, false);
});

test('minAreaRect · pătrat rotit 45°', () => {
  const r = minAreaRect([[0, 1], [1, 0], [2, 1], [1, 2]]);
  close(r.length, Math.SQRT2, 1e-6);
  close(r.width, Math.SQRT2, 1e-6);
});

test('RoomPlan JSON · scanarea demo (5 pereți, 1 ușă, 2 ferestre, rotită 14°)', () => {
  const s = parseRoomPlanJson(JSON.stringify(buildDemoRoomPlan()));
  close(s.lengthM, 4.85);
  close(s.widthM, 3.9);
  close(s.heightM, 2.65);
  close(s.floorAreaSqm, 18.92);
  close(s.volumeM3, 50.12, 0.02);
  assert.equal(s.wallCount, 5);
  assert.equal(s.doorCount, 1);
  assert.equal(s.windowCount, 2);
  close(s.wallAreaGrossSqm, 46.38, 0.02);
  close(s.wallAreaNetSqm, 46.375 - 1.89 - 2.1 - 1.68, 0.02);
  assert.ok(s.notes.some((n) => n.code === 'floor-from-polygon'));
  // Toate muchiile sunt în cadrul camerei
  for (const e of s.edges) for (const p of [e.a, e.b]) {
    assert.ok(p[0] > -0.02 && p[0] < 4.87 && p[2] > -0.02 && p[2] < 3.92 && p[1] > -0.02 && p[1] < 2.67, `edge ${p}`);
  }
  const demo = loadDemoScan();
  assert.equal(demo.source, 'demo');
  const m = measurementFromScan(demo);
  assert.equal(m.doors, 1);
  assert.equal(m.windows, 2);
});

test('RoomPlan JSON · transformări 4×4 imbricate, CapturedStructure cu rooms[]', () => {
  const room = buildDemoRoomPlan();
  const nested = {
    rooms: [{
      ...room,
      walls: (room.walls as { transform: number[] }[]).map((w) => ({ ...w, transform: [0, 1, 2, 3].map((c) => w.transform.slice(c * 4, c * 4 + 4)) })),
    }],
  };
  const s = parseRoomPlanJson(JSON.stringify(nested));
  close(s.lengthM, 4.85);
  close(s.widthM, 3.9);
  assert.equal(s.wallCount, 5);
});

test('JSON simplu cu dimensiuni (cm) + număr de goluri', () => {
  const s = parseRoomPlanJson(JSON.stringify({ unit: 'cm', dimensions: { length: 390, width: 485, height: 265 }, doors: 1, windows: [{}, {}] }));
  assert.equal(s.source, 'dimensions');
  close(s.lengthM, 4.85);
  close(s.widthM, 3.9);
  close(s.heightM, 2.65);
  assert.equal(s.doorCount, 1);
  assert.equal(s.windowCount, 2);
  assert.throws(() => parseRoomPlanJson('{oops'), (e: unknown) => e instanceof ScanParseError && e.code === 'invalid-json');
  assert.throws(() => parseRoomPlanJson('{"walls": []}'), (e: unknown) => e instanceof ScanParseError && e.code === 'no-room');
});

const USDA = `#usda 1.0
(
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "Room" {
    double3 xformOp:translate = (10, -1.3, 4)
    uniform token[] xformOpOrder = ["xformOp:translate"]
    def Cube "Wall0" {
        double size = 1
        double3 xformOp:translate = (2.425, 1.325, 0)
        float3 xformOp:scale = (4.85, 2.65, 0.1)
    }
    def Cube "Wall1" {
        double size = 1
        double3 xformOp:translate = (2.425, 1.325, 3.9)
        float3 xformOp:scale = (4.85, 2.65, 0.1)
    }
    def Mesh "Floor0" {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 3, 2, 1]
        point3f[] points = [(0, 0, 0), (4.85, 0, 0),
            (4.85, 0, 3.9), (0, 0, 3.9)]
    }
    def Cube "Door0" {
        double size = 1
        float3 xformOp:scale = (0.9, 2.1, 0.05)
        double3 xformOp:translate = (1, 1.05, 0)
    }
}
`;

test('USDA · ierarhie xformOp + Cube + Mesh', () => {
  const s = parseUsda(USDA);
  close(s.lengthM, 4.85);
  close(s.widthM, 4.0, 0.011); // pereții au 10 cm grosime (±5 cm față de axe)
  close(s.heightM, 2.65);
  assert.equal(s.unit, 'm');
  assert.equal(s.wallCount, 2);
  assert.equal(s.doorCount, 1);
});

/** Arhivă ZIP minimală (stocare fără compresie, ca USDZ). */
function makeZip(files: { name: string; data: Uint8Array }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    chunks.push(local, f.data);
    central.push(cd);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out.buffer;
}

test('USDZ · director central ZIP + strat USDA', async () => {
  const enc = new TextEncoder();
  const zip = makeZip([
    { name: 'textures/thumb.png', data: new Uint8Array([137, 80, 78, 71]) },
    { name: 'Room.usda', data: enc.encode(USDA) },
  ]);
  assert.deepEqual(readZipDirectory(zip).map((e) => e.name), ['textures/thumb.png', 'Room.usda']);
  const s = await parseUsdz(zip, { fileName: 'Room.usdz' });
  assert.equal(s.source, 'usdz');
  close(s.lengthM, 4.85);
  close(s.heightM, 2.65);
  assert.ok(s.notes.some((n) => n.code === 'usda-entry'));
});

test('USDZ · JSON RoomPlan inclus are prioritate; crate binar → eroare explicită', async () => {
  const enc = new TextEncoder();
  const withJson = makeZip([{ name: 'Room.json', data: enc.encode(JSON.stringify(buildDemoRoomPlan())) }]);
  const s = await parseUsdz(withJson);
  assert.equal(s.windowCount, 2);
  const binary = makeZip([{ name: 'Room.usdc', data: enc.encode('PXR-USDC\u0000\u0000Wall0\u0000Wall1\u0000Door0\u0000') }]);
  await assert.rejects(parseUsdz(binary), (e: unknown) => e instanceof ScanParseError && e.code === 'usdz-binary' && /walls=2/.test(e.detail ?? ''));
  await assert.rejects(parseUsdz(new ArrayBuffer(10)), (e: unknown) => e instanceof ScanParseError && e.code === 'zip-invalid');
});

test('parseScanFile · dispecer după extensie', async () => {
  const file = (name: string, text: string) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer });
  assert.equal((await parseScanFile(file('scan.OBJ', roomObj()))).source, 'obj');
  assert.equal((await parseScanFile(file('room.json', JSON.stringify(buildDemoRoomPlan())))).source, 'roomplan');
  await assert.rejects(parseScanFile(file('scan.ply', 'ply')), (e: unknown) => e instanceof ScanParseError && e.code === 'unsupported');
});
