// tests/texturedScan.test.mts — `pnpm test` (node --test, fără dependențe).
// Scanările reale texturate: arhiva Scaniverse .zip (obj + mtl + jpg), fișiere selectate împreună, UV / fețe / culori
// pe vârf, plasa GPU în cadrul aliniat al camerei și cotele reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  ScanParseError,
  loadDemoScan,
  parseMtl,
  parseObj,
  parseRoomPlanJson,
  parseScanFiles,
  buildDemoRoomPlan,
  type RoomScan,
} from '../app/lib/studio/lidarParser.ts';

const close = (actual: number, expected: number, tol = 0.011, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);

type V = [number, number, number];
const enc = new TextEncoder();
/** Un „JPEG” minimal (doar semnătura): parserul nu decodează imaginea, doar o transportă la GPU. */
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/**
 * Camera ca plasă texturată, ca un export Scaniverse: 6 patrulatere (podea, tavan, 4 pereți) cu `vt` proprii (atlas),
 * fețe `v/vt/vn`, `mtllib` + `usemtl`, opțional culori pe vârf, rotită în plan, fețele orientate spre interior
 * (sau inversate cu `flip`).
 */
function texturedRoomObj({ L = 4.2, W = 3.1, H = 2.55, yawDeg = 0, colors = false, flip = false, mtl = true } = {}): string {
  const yaw = (yawDeg * Math.PI) / 180;
  const tf = ([x, y, z]: V): V => [x * Math.cos(yaw) - z * Math.sin(yaw) + 7.5, y - 1.3, x * Math.sin(yaw) + z * Math.cos(yaw) - 2];
  const corners: V[] = [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W], [0, H, 0], [L, H, 0], [L, H, W], [0, H, W]];
  const lines = ['# Scaniverse export', mtl ? 'mtllib model.mtl' : '', 'o Mesh'];
  for (const c of corners) {
    const [x, y, z] = tf(c);
    lines.push(colors ? `v ${x} ${y} ${z} ${(200 + c[1] * 10).toFixed(0)} 120 90` : `v ${x} ${y} ${z}`);
  }
  // Patrulaterele (indici 0-based în `corners`) + centrul camerei pentru orientare
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const center: V = [L / 2, H / 2, W / 2];
  if (mtl) lines.push('usemtl material0');
  let vt = 0;
  quads.forEach((q, qi) => {
    // Atlas 3 × 2: fiecare față are propriul dreptunghi de textură (cusături = același vârf, UV diferit)
    const u0 = (qi % 3) / 3, v0 = Math.floor(qi / 3) / 2;
    for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) lines.push(`vt ${u0 + du / 3} ${v0 + dv / 2}`);
    // Orientare: normala (Newell) spre interior; `flip` = spre exterior
    const p = q.map((i) => corners[i]);
    const n = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const a = p[k], b = p[(k + 1) % 4];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const c = p.reduce((s, x) => [s[0] + x[0] / 4, s[1] + x[1] / 4, s[2] + x[2] / 4], [0, 0, 0]);
    const inward = n[0] * (c[0] - center[0]) + n[1] * (c[1] - center[1]) + n[2] * (c[2] - center[2]) < 0;
    const order = inward !== flip ? [0, 1, 2, 3] : [3, 2, 1, 0];
    lines.push(`f ${order.map((k) => `${q[k] + 1}/${vt + k + 1}/1`).join(' ')}`);
    vt += 4;
  });
  return lines.join('\n');
}

const MTL = ['# Scaniverse', 'newmtl material0', 'Ka 1 1 1', 'Kd 1 1 1', 'map_Kd -s 1 1 1 textures/model.jpg', ''].join('\n');

/** Arhivă ZIP (stocare sau deflate, ca exporturile reale). */
function makeZip(files: { name: string; data: Uint8Array }[], deflate = false): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const method = deflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    chunks.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
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

const fileOf = (name: string, data: Uint8Array | ArrayBuffer | string) => ({
  name,
  arrayBuffer: async () => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    return bytes.slice().buffer as ArrayBuffer;
  },
});

/** Verifică plasa GPU: dimensiuni coerente, vârfuri în cutia camerei (cadrul aliniat), indici valizi. */
function assertMeshInRoom(s: RoomScan) {
  const m = s.mesh;
  assert.ok(m, 'mesh lipsă');
  assert.equal(m.indices.length, m.triangleCount * 3);
  const nv = m.positions.length / 3;
  for (const i of m.indices) assert.ok(i < nv, `indice ${i} ≥ ${nv}`);
  if (m.uvs) assert.equal(m.uvs.length, nv * 2);
  if (m.colors) assert.equal(m.colors.length, nv * 3);
  for (let i = 0; i < nv; i++) {
    const [x, y, z] = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    assert.ok(x > -0.02 && x < s.lengthM + 0.02 && y > -0.02 && y < s.heightM + 0.02 && z > -0.02 && z < s.widthM + 0.02, `vârf în afara camerei: ${x}, ${y}, ${z}`);
  }
  assert.equal(m.groups.reduce((n, g) => n + g.count, 0), m.indices.length);
}

test('parseMtl · map_Kd cu opțiuni și cale, Kd', () => {
  const mats = parseMtl(`${MTL}\nnewmtl wall\nKd 0.8 0.7 0.6\nnewmtl spaced\nmap_Kd -bm 0.5 -clamp on my texture.png`);
  assert.equal(mats.get('material0')?.map, 'model.jpg');
  assert.deepEqual(mats.get('wall')?.kd, [0.8, 0.7, 0.6]);
  assert.equal(mats.get('spaced')?.map, 'my texture.png');
});

test('OBJ texturat · vt + fețe v/vt/vn → plasă GPU de-indexată, cote reale', () => {
  const s = parseObj(texturedRoomObj(), { fileName: 'model.obj' }, { mtl: [{ name: 'model.mtl', text: MTL }], textures: [{ name: 'model.jpg', mime: 'image/jpeg', data: JPG }] });
  close(s.lengthM, 4.2);
  close(s.widthM, 3.1);
  close(s.heightM, 2.55);
  close(s.floorAreaSqm, 4.2 * 3.1, 0.05);
  close(s.volumeM3, 4.2 * 3.1 * 2.55, 0.15);
  assertMeshInRoom(s);
  const m = s.mesh!;
  // 6 patrulatere → 12 triunghiuri; 8 colțuri × 3 fețe adiacente = 24 perechi (v, vt) distincte (cusăturile atlasului)
  assert.equal(m.triangleCount, 12);
  assert.equal(m.positions.length / 3, 24);
  assert.ok(m.uvs);
  assert.equal(m.colors, null);
  assert.deepEqual(m.groups.map((g) => g.texture), ['model.jpg']);
  assert.deepEqual(m.textures.map((t) => [t.name, t.mime, t.data.length]), [['model.jpg', 'image/jpeg', JPG.length]]);
  assert.equal(m.windingInward, true);
  assert.ok(s.notes.some((n) => n.code === 'textured-mesh' && n.value === 'model.jpg'));
  // UV-urile rămân în atlas (0–1) și nu se pierd la de-indexare
  for (const u of m.uvs) assert.ok(u >= 0 && u <= 1);
  assert.ok(new Set(Array.from(m.uvs).map((u) => u.toFixed(3))).size > 4);
});

test('OBJ texturat · rotit 27° și deplasat: aliniat la pereți, plasa în cadrul camerei', () => {
  const s = parseObj(texturedRoomObj({ yawDeg: 27 }), {}, { textures: [{ name: 'model.jpg', mime: 'image/jpeg', data: JPG }] });
  close(s.lengthM, 4.2);
  close(s.widthM, 3.1);
  close(s.heightM, 2.55);
  assert.ok(s.notes.some((n) => n.code === 'rotated'));
  assertMeshInRoom(s);
  // Fără .mtl, o singură imagine = textura întregii plase
  assert.deepEqual(s.mesh!.groups.map((g) => g.texture), ['model.jpg']);
});

test('OBJ · culori pe vârf (0–255 → 0–1) și orientarea fețelor inversată', () => {
  const s = parseObj(texturedRoomObj({ colors: true, flip: true, mtl: false }));
  const m = s.mesh!;
  assert.ok(m.colors);
  for (const c of m.colors) assert.ok(c >= 0 && c <= 1, `culoare ${c}`);
  close(m.colors[1], 120 / 255, 1e-6);
  assert.equal(m.windingInward, false);
  assert.ok(s.notes.some((n) => n.code === 'vertex-colors'));
  // Fără textură: grupul e colorat
  assert.equal(m.groups[0].texture, null);
});

test('OBJ · textură din .mtl lipsă → notă explicită, plasa rămâne colorată', () => {
  const s = parseObj(texturedRoomObj(), {}, { mtl: [{ name: 'model.mtl', text: MTL }] });
  assert.ok(s.notes.some((n) => n.code === 'texture-missing' && n.value === 'model.jpg'));
  assert.equal(s.mesh!.groups[0].texture, null);
  assert.equal(s.mesh!.textures.length, 0);
});

for (const deflate of [false, true]) {
  test(`Scaniverse .zip (${deflate ? 'deflate' : 'stocare'}) · obj + mtl + jpg extrase, cote reale`, async () => {
    const zip = makeZip(
      [
        { name: 'Scan 2026-11-18/', data: new Uint8Array() },
        { name: 'Scan 2026-11-18/model.obj', data: enc.encode(texturedRoomObj({ yawDeg: -12 })) },
        { name: 'Scan 2026-11-18/model.mtl', data: enc.encode(MTL) },
        { name: 'Scan 2026-11-18/textures/model.jpg', data: JPG },
        { name: '__MACOSX/Scan 2026-11-18/._model.obj', data: enc.encode('junk') },
      ],
      deflate,
    );
    const s = await parseScanFiles([fileOf('Scaniverse_Living.zip', zip)]);
    assert.equal(s.source, 'obj');
    assert.equal(s.fileName, 'Scaniverse_Living.zip');
    close(s.lengthM, 4.2);
    close(s.widthM, 3.1);
    close(s.heightM, 2.55);
    assertMeshInRoom(s);
    assert.deepEqual(s.mesh!.groups.map((g) => g.texture), ['model.jpg']);
    assert.deepEqual(Array.from(s.mesh!.textures[0].data), Array.from(JPG));
    assert.ok(s.notes.some((n) => n.code === 'zip-entry' && n.value === 'Scan 2026-11-18/model.obj'));
  });
}

test('selecție multiplă · .obj + .mtl + .jpg (ordinea nu contează), .obj + .jpg fără .mtl', async () => {
  const obj = texturedRoomObj();
  const all = await parseScanFiles([fileOf('model.jpg', JPG), fileOf('model.mtl', MTL), fileOf('model.obj', obj)]);
  assert.equal(all.fileName, 'model.obj');
  assert.deepEqual(all.mesh!.groups.map((g) => g.texture), ['model.jpg']);
  const noMtl = await parseScanFiles([fileOf('scan.obj', obj.replace('mtllib model.mtl', '')), fileOf('photo.JPEG', JPG)]);
  assert.deepEqual(noMtl.mesh!.groups.map((g) => g.texture), ['photo.JPEG']);
  assert.equal(noMtl.mesh!.textures[0].mime, 'image/jpeg');
});

test('.zip fără model → zip-no-model; .zip cu JSON RoomPlan → cotele RoomPlan; doar imagini → unsupported', async () => {
  await assert.rejects(
    parseScanFiles([fileOf('photos.zip', makeZip([{ name: 'a.jpg', data: JPG }]))]),
    (e: unknown) => e instanceof ScanParseError && e.code === 'zip-no-model',
  );
  const rp = await parseScanFiles([fileOf('room.zip', makeZip([{ name: 'Room.json', data: enc.encode(JSON.stringify(buildDemoRoomPlan())) }], true))]);
  assert.equal(rp.windowCount, 2);
  assert.equal(rp.mesh, undefined);
  await assert.rejects(parseScanFiles([fileOf('a.jpg', JPG)]), (e: unknown) => e instanceof ScanParseError && e.code === 'unsupported');
});

test('compatibilitate: RoomPlan JSON / demo fără plasă (schema rămâne), OBJ simplu fără vt are plasă colorată', () => {
  assert.equal(loadDemoScan().mesh, undefined);
  assert.equal(parseRoomPlanJson(JSON.stringify({ dimensions: [4, 3, 2.6] })).mesh, undefined);
  const plain = parseObj(texturedRoomObj({ mtl: false }).replace(/^vt .*$/gm, '').replace(/(\d+)\/\d+\/1/g, '$1'));
  assertMeshInRoom(plain);
  assert.equal(plain.mesh!.uvs, null);
  assert.equal(plain.mesh!.positions.length / 3, 8); // fără UV: vârfurile se refolosesc
  close(plain.lengthM, 4.2);
});
// ── OBJ colorat pe vârf (`v x y z r g b`) prin puntea iPhone: plasă completă, normale netede, culori exacte ──

/** O cameră LiDAR „densă”: podeaua ca grilă n × n (vârfuri comune) + pereți, culori 0–255 pe fiecare vârf. */
function coloredLidarObj(L = 4, W = 3, H = 2.6, n = 6): string {
  const lines = ['# iPhone LiDAR export', 'o Mesh'];
  const vid = (i: number, j: number) => i * (n + 1) + j + 1;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    // Undă ușoară pe podea: normalele netede trebuie să varieze lin, nu pe fațete
    const y = 0.01 * Math.sin(i) * Math.cos(j);
    lines.push(`v ${(L * i) / n} ${y} ${(W * j) / n} ${180 + i} ${140 + j} 100`);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    lines.push(`f ${vid(i, j)} ${vid(i, j + 1)} ${vid(i + 1, j + 1)} ${vid(i + 1, j)}`);
  }
  // Pereții: 4 patrulatere separate (vârfuri proprii, ca exporturile RoomPlan / Scaniverse pe obiecte)
  const base = (n + 1) * (n + 1);
  const walls: V[][] = [
    [[0, 0, 0], [L, 0, 0], [L, H, 0], [0, H, 0]],
    [[L, 0, 0], [L, 0, W], [L, H, W], [L, H, 0]],
    [[L, 0, W], [0, 0, W], [0, H, W], [L, H, W]],
    [[0, 0, W], [0, 0, 0], [0, H, 0], [0, H, W]],
  ];
  walls.forEach((q, k) => {
    for (const [x, y, z] of q) lines.push(`v ${x} ${y} ${z} 235 228 220`);
    const o = base + k * 4 + 1;
    lines.push(`f ${o} ${o + 1} ${o + 2} ${o + 3}`);
  });
  return lines.join('\r\n'); // CRLF, ca fișierele scrise pe iOS / Windows
}

test('punte iPhone · .obj cu culori pe vârf → plasă colorată completă, cote metrice reale', async () => {
  const { bridgeScanFileLike, readLatest } = await import('../app/lib/studio/lidarBridge.ts');
  const latest = readLatest({ hasNewScan: true, scanId: 'a1', fileName: 'Living.obj', contentType: 'model/obj', encoding: 'utf8', rawPayload: coloredLidarObj() });
  assert.equal(latest.hasNewScan, true);
  if (!latest.hasNewScan) return;
  const s = await parseScanFiles([bridgeScanFileLike(latest)]);
  close(s.lengthM, 4);
  close(s.widthM, 3);
  close(s.heightM, 2.6);
  const m = s.mesh;
  assert.ok(m, 'plasa trebuie să existe');
  // Toate fețele: 36 de patrulatere pe podea + 4 pereți = 80 de triunghiuri
  assert.equal(m.triangleCount, 80);
  assert.equal(m.indices.length, 240);
  assert.ok(m.colors);
  assert.equal(m.colors.length, m.positions.length);
  for (const c of m.colors) assert.ok(c >= 0 && c <= 1);
  // Culoarea exactă a unui vârf de pe perete (235, 228, 220) / 255 se regăsește
  let found = false;
  for (let i = 0; i < m.colors.length; i += 3) {
    if (Math.abs(m.colors[i] - 235 / 255) < 1e-6 && Math.abs(m.colors[i + 1] - 228 / 255) < 1e-6) found = true;
  }
  assert.ok(found, 'culoarea pereților lipsește');
  assert.ok(s.notes.some((n) => n.code === 'vertex-colors'));
});

test('ScanMesh.normals · unitare, netede pe plasa densă, plane pe pereții separați', () => {
  const s = parseObj(coloredLidarObj());
  const m = s.mesh!;
  assert.equal(m.normals.length, m.positions.length);
  let floorVerts = 0;
  for (let i = 0; i < m.normals.length / 3; i++) {
    const nx = m.normals[i * 3], ny = m.normals[i * 3 + 1], nz = m.normals[i * 3 + 2];
    close(Math.hypot(nx, ny, nz), 1, 1e-5, `normala ${i}`);
    const y = m.positions[i * 3 + 1];
    if (y < 0.05 && Math.abs(ny) > 0.9) floorVerts++;
    // Vârfurile pereților (separate) au exact normala orizontală a peretelui
    if (y > 2.5) close(Math.abs(ny), 0, 1e-5, 'perete');
  }
  // Podeaua: 7 × 7 vârfuri, toate aproape verticale (undă de 1 cm), dar nu toate identice (umbrire netedă, nu plană)
  assert.equal(floorVerts, 49);
  const floorNy = new Set<string>();
  for (let i = 0; i < 49; i++) floorNy.add(m.normals[i * 3].toFixed(4));
  assert.ok(floorNy.size > 3, 'normalele podelei variază lin');
});

test('ScanMesh.normals · cusăturile UV nu rup umbrirea (același vârf OBJ → aceeași normală)', () => {
  const s = parseObj(texturedRoomObj({ colors: true }));
  const m = s.mesh!;
  const byPos = new Map<string, string>();
  for (let i = 0; i < m.positions.length / 3; i++) {
    const key = [0, 1, 2].map((k) => m.positions[i * 3 + k].toFixed(4)).join(',');
    const n = [0, 1, 2].map((k) => m.normals[i * 3 + k].toFixed(5)).join(',');
    const prev = byPos.get(key);
    if (prev) assert.equal(n, prev, `cusătură la ${key}`);
    else byPos.set(key, n);
  }
  assert.ok(m.positions.length / 3 > byPos.size, 'testul trebuie să conțină cusături');
});

test('culori pe vârf parțiale (≥ 90 %), 0–255: vârfurile necolorate primesc griul implicit, nu negru', () => {
  const lines = ['o Mesh'];
  const pts: V[] = [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3], [0, 2.6, 0], [4, 2.6, 0], [4, 2.6, 3], [0, 2.6, 3]];
  // 10 vârfuri colorate (dublate la podea) + 1 necolorat = 91 %
  pts.forEach(([x, y, z], i) => lines.push(i === 7 ? `v ${x} ${y} ${z}` : `v ${x} ${y} ${z} 250 10 10`));
  lines.push('v 2 0 1.5 250 10 10', 'v 2 2.6 1.5 250 10 10', 'v 1 0 1 250 10 10');
  lines.push('f 1 2 3 4', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8');
  const m = parseObj(lines.join('\n')).mesh!;
  assert.ok(m.colors);
  // Vârful 8 (indice 7, fără UV ⇒ indicele GPU = indicele OBJ)
  close(m.colors[7 * 3], 0.9, 1e-6);
  close(m.colors[7 * 3 + 1], 0.87, 1e-6);
  close(m.colors[0], 250 / 255, 1e-6);
});
