import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_COLORS, fixtureColor, fixtureLabel, fixtureSummary, parseDetectedFixtures } from '../app/lib/studio/fixtures.ts';

test('parseDetectedFixtures keeps valid boxes and the shield flag', () => {
  const fixtures = parseDetectedFixtures([
    { kind: 'outlet', x: 0.12, y: 0.79, width: 0.03, height: 0.04, confidence: 0.92, shielded: true },
    { kind: 'window', x: 0.6, y: 0.1, width: 0.25, height: 0.45, confidence: 0.97, shielded: false },
  ]);
  assert.equal(fixtures.length, 2);
  assert.deepEqual(fixtures[0], { kind: 'outlet', x: 0.12, y: 0.79, width: 0.03, height: 0.04, confidence: 0.92, shielded: true });
  assert.equal(fixtures[1].shielded, false);
});

test('parseDetectedFixtures drops unknown kinds, bad numbers and non-arrays; clips to the frame', () => {
  assert.deepEqual(parseDetectedFixtures(undefined), []);
  assert.deepEqual(parseDetectedFixtures({ kind: 'outlet' }), []);
  const fixtures = parseDetectedFixtures([
    { kind: 'sofa', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { kind: 'outlet', x: 'abc', y: 0.1, width: 0.2, height: 0.2 },
    { kind: 'outlet', x: 0.1, y: 0.1, width: -0.2, height: 0.2 },
    null,
    { kind: 'door', x: 0.9, y: -0.2, width: 0.3, height: 0.7, shielded: 'yes' },
  ]);
  assert.equal(fixtures.length, 1);
  const door = fixtures[0];
  assert.equal(door.x, 0.9);
  assert.equal(door.y, 0);
  assert.ok(Math.abs(door.width - 0.1) < 1e-9);
  assert.equal(door.confidence, 0.5);
  assert.equal(door.shielded, false);
});

test('colours, labels and summary', () => {
  assert.equal(fixtureColor('outlet'), FIXTURE_COLORS.mep);
  assert.equal(fixtureColor('corner'), FIXTURE_COLORS.structure);
  assert.equal(FIXTURE_COLORS.mep, '#5C1628');
  assert.equal(FIXTURE_COLORS.structure, '#A67C52');
  assert.equal(fixtureLabel('switch', 'ro'), 'Întrerupător');
  assert.equal(fixtureLabel('radiator', 'en'), 'Radiator');
  const summary = fixtureSummary(parseDetectedFixtures([
    { kind: 'outlet', x: 0.1, y: 0.8, width: 0.03, height: 0.04, shielded: true },
    { kind: 'radiator', x: 0.4, y: 0.7, width: 0.2, height: 0.1 },
    { kind: 'door', x: 0.05, y: 0.2, width: 0.15, height: 0.7 },
    { kind: 'corner', x: 0.5, y: 0.08, width: 0.02, height: 0.02 },
  ]));
  assert.deepEqual(summary, { mep: 2, openings: 1, corners: 1, shielded: 1 });
});
