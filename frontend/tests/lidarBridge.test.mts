// tests/lidarBridge.test.mts — puntea iPhone RoomPlan: payload-ul backend → același parser ca importul manual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeScanFileLike,
  bridgeScanToFile,
  formatPairingCode,
  isPairingCode,
  readLatest,
  secondsUntil,
} from '../app/lib/studio/lidarBridge.ts';
import { buildDemoRoomPlan, loadDemoScan, measurementFromScan, parseScanFile } from '../app/lib/studio/lidarParser.ts';

const close = (a: number, b: number, tol = 0.011) => assert.ok(Math.abs(a - b) <= tol, `expected ${b} ± ${tol}, got ${a}`);

test('pairing codes: exactly six digits, grouped 3 + 3', () => {
  assert.ok(isPairingCode('482910'));
  assert.ok(!isPairingCode('48291'));
  assert.ok(!isPairingCode('48291a'));
  assert.equal(formatPairingCode('482910'), '482 910');
  assert.equal(secondsUntil('2026-11-20T10:15:00Z', Date.parse('2026-11-20T10:00:00Z')), 900);
  assert.equal(secondsUntil('2026-11-20T10:15:00Z', Date.parse('2026-11-20T11:00:00Z')), 0);
  assert.equal(secondsUntil('nonsense'), 0);
});

test('readLatest validates the GET /latest body', () => {
  assert.deepEqual(readLatest(null), { hasNewScan: false });
  assert.equal(readLatest({ hasNewScan: true, scanId: 'x' }).hasNewScan, false); // incomplete → ignored
  const waiting = readLatest({ hasNewScan: false, expiresAtUtc: '2026-11-20T10:15:00Z', codeExpired: false });
  assert.equal(waiting.hasNewScan, false);
  assert.equal(waiting.expiresAtUtc, '2026-11-20T10:15:00Z');
  const scan = readLatest({ hasNewScan: true, scanId: 'a', fileName: 'x.json', contentType: 'application/json', encoding: 'utf8', rawPayload: '{}', uploadedAtUtc: 'now' });
  assert.equal(scan.hasNewScan, true);
});

test('a RoomPlan CapturedRoom JSON from the bridge parses exactly like the manual import', async () => {
  const raw = JSON.stringify(buildDemoRoomPlan());
  const latest = readLatest({
    hasNewScan: true, scanId: 's1', fileName: 'Living.json', contentType: 'application/json', encoding: 'utf8',
    rawPayload: raw, uploadedAtUtc: '2026-11-20T10:03:00Z',
  });
  assert.equal(latest.hasNewScan, true);
  if (!latest.hasNewScan) return;
  const scan = await parseScanFile(bridgeScanFileLike(latest));
  const expected = measurementFromScan(loadDemoScan());
  const m = measurementFromScan(scan);
  assert.equal(scan.source, 'roomplan');
  close(m.lengthM, expected.lengthM);
  close(m.widthM, expected.widthM);
  close(m.heightM, expected.heightM);
  assert.equal(m.doors, expected.doors);
  assert.equal(m.windows, expected.windows);
});

test('base64 payloads (.zip / .usdz) round-trip byte for byte; utf8 keeps diacritics', () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80]);
  const b64 = Buffer.from(bytes).toString('base64');
  const file = bridgeScanToFile({ hasNewScan: true, scanId: 'z', fileName: 'scan.zip', contentType: 'application/zip', encoding: 'base64', rawPayload: b64, uploadedAtUtc: '' });
  assert.deepEqual([...file.bytes], [...bytes]);
  const text = bridgeScanToFile({ hasNewScan: true, scanId: 't', fileName: 'Bucătărie.obj', contentType: 'model/obj', encoding: 'utf8', rawPayload: '# Bucătărie\nv 0 0 0', uploadedAtUtc: '' });
  assert.equal(new TextDecoder().decode(text.bytes), '# Bucătărie\nv 0 0 0');
  assert.equal(text.name, 'Bucătărie.obj');
});
