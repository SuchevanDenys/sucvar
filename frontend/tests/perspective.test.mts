// tests/perspective.test.ts — calibrarea din fotografie pe o cameră sintetică (proiecție pinhole cunoscută).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHomography, calibrateFromPhoto, solveHomography, type Pt } from '../app/lib/studio/perspective.ts';

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Cameră pinhole: poziție, țintă, focală (px), imagine W × H. Lume Y-sus. */
function camera(pos: V, target: V, f: number, W: number, H: number) {
  const fwd = unit(sub(target, pos));
  const right = unit(cross([0, 1, 0], fwd));
  let down = unit(cross(fwd, right));
  if (down[1] > 0) down = [-down[0], -down[1], -down[2]];
  return (p: V): Pt => {
    const d = sub(p, pos);
    const z = dot(d, fwd);
    assert.ok(z > 0, 'point in front of camera');
    return { x: (f * dot(d, right)) / z + W / 2, y: (f * dot(d, down)) / z + H / 2 };
  };
}

const L = 4.85, Wd = 3.9, Hroom = 2.65;

test('calibrare · focala din punctele de fugă + ușa de 2,10 m ⇒ cotele camerei', () => {
  const W = 4032, H = 3024, f = 2900;
  // Telefonul în afara camerei (în ușa de pe latura scurtă), la 1,45 m, privind în diagonală spre colțul opus
  const project = camera([-1.6, 1.45, -1.1], [3.2, 0.5, 2.6], f, W, H);
  const floor: V[] = [[L, 0, 0], [L, 0, Wd], [0, 0, Wd], [0, 0, 0]];
  const pts = floor.map(project);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const r = calibrateFromPhoto({
    imageWidth: W,
    imageHeight: H,
    floor: pts as [Pt, Pt, Pt, Pt],
    refBottom: project([L, 0, 1.9]),
    refTop: project([L, 2.1, 1.9]),
    refHeightM: 2.1,
    ceiling: project([L, Hroom, 0]),
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.focalSource, 'vanishing');
  assert.ok(Math.abs(r.focalPx - f) / f < 0.01, `focal ${r.focalPx}`);
  assert.ok(Math.abs(r.lengthM - L) < 0.02, `L ${r.lengthM}`);
  assert.ok(Math.abs(r.widthM - Wd) < 0.02, `W ${r.widthM}`);
  assert.ok(r.heightM !== null && Math.abs(r.heightM - Hroom) < 0.02, `H ${r.heightM}`);
  assert.equal(r.quality, 'good');
  assert.ok(Math.abs(r.areaSqm - L * Wd) < 0.15);
});

test('calibrare · focală cunoscută, colțul A la stânga-spate', () => {
  const W = 1600, H = 1200, f = 1250;
  const project = camera([2.4, 1.6, -1.2], [2.4, 0.4, 2.6], f, W, H);
  const floor: V[] = [[0, 0, Wd], [L, 0, Wd], [L, 0, 0], [0, 0, 0]];
  const r = calibrateFromPhoto({
    imageWidth: W,
    imageHeight: H,
    floor: floor.map(project) as [Pt, Pt, Pt, Pt],
    refBottom: project([1, 0, Wd]),
    refTop: project([1, 2.1, Wd]),
    refHeightM: 2.1,
    ceiling: project([0, Hroom, Wd]),
    focalPx: f,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(Math.abs(r.lengthM - L) < 0.02, `L ${r.lengthM}`);
  assert.ok(Math.abs(r.widthM - Wd) < 0.02, `W ${r.widthM}`);
  assert.ok(r.heightM !== null && Math.abs(r.heightM - Hroom) < 0.02, `H ${r.heightM}`);
});

test('calibrare · erori: patrulater degenerat, referință inversată', () => {
  const p = { x: 10, y: 10 };
  const bad = calibrateFromPhoto({ imageWidth: 100, imageHeight: 100, floor: [p, p, p, p], refBottom: p, refTop: p, refHeightM: 2.1 });
  assert.deepEqual(bad, { ok: false, error: 'degenerate' });
  const W = 1600, H = 1200, f = 1250;
  const project = camera([2.4, 1.6, -1.2], [2.4, 0.4, 2.6], f, W, H);
  const floor: V[] = [[0, 0, Wd], [L, 0, Wd], [L, 0, 0], [0, 0, 0]];
  const flipped = calibrateFromPhoto({
    imageWidth: W, imageHeight: H, floor: floor.map(project) as [Pt, Pt, Pt, Pt],
    refBottom: project([1, 2.1, Wd]), refTop: project([1, 0, Wd]), refHeightM: 2.1, focalPx: f,
  });
  assert.equal(flipped.ok, false);
});

test('omografie · pătratul unitate pe un patrulater oarecare', () => {
  const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const dst = [{ x: 100, y: 120 }, { x: 420, y: 90 }, { x: 500, y: 400 }, { x: 60, y: 380 }];
  const Hm = solveHomography(src, dst);
  assert.ok(Hm);
  for (let i = 0; i < 4; i++) {
    const q = applyHomography(Hm!, src[i]);
    assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
  }
});
