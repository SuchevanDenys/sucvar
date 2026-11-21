// Golden fixture for SpatialErgonomicsAnalyzer.cs ↔ frontend/app/lib/studio/ergonomics.ts parity.
// Run from the repo root:  node backend/tools/golden/ergonomics.mts
// Writes backend/tests/Sucvar.Tests/Fixtures/golden-ergonomics.json (consumed by ErgonomicsParityTests).
import { writeFileSync } from 'node:fs';
import { analyzeErgonomics, OPTIMIZATION_GOALS, type OptimizationGoalId } from '../../../frontend/app/lib/studio/ergonomics.ts';

const spaces: (string | null)[] = [
  'living room', 'master bedroom', 'kitchen', 'bathroom', 'home office', 'entryway', 'walk-in closet',
  'attic loft', 'commercial cafe', 'unknown space', '', '  kitchen  ', null,
];
const goals: (string | null)[] = [null, ...OPTIMIZATION_GOALS.map((g) => g.id), 'bogus'];
// Typical rooms, swapped sides, narrow / tall / low / huge rooms, midpoint-rounding traps and invalid values
const dims: [number | null, number | null, number | null][] = [
  [5, 4, 2.65], [4, 5, 2.65], [2.8, 4.5, 2.6], [4.2, 2.8, 2.55], [7, 5, 2.9], [6, 4.5, 2.3], [2.2, 1.6, 2.4],
  [12, 9, 4.2], [3.35, 2.15, 2.75], [1.005, 2.675, 2.345], [3.125, 3.125, 3.5], [0.4, 0.4, 1.2], [150, 120, 20],
  [null, null, null], [0, 0, 0], [-3, 4, 2.6], [5, null, 2.7], [5, 4, null],
];

const cases = [];
for (const space of spaces)
  for (const goal of goals)
    for (const [length, width, height] of dims)
      cases.push({ space, goal, length, width, height, report: analyzeErgonomics(space, { length, width, height }, goal as OptimizationGoalId | null) });

const out = new URL('../../tests/Sucvar.Tests/Fixtures/golden-ergonomics.json', import.meta.url);
writeFileSync(out, JSON.stringify(cases));
console.log(`${cases.length} cases → ${out.pathname}`);
