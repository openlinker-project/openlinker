#!/usr/bin/env node
/**
 * check-location-page-size-mirror.mjs
 *
 * Lint-time invariant for the browser's copy of the inventory-locations page
 * cap (#3634 review).
 *
 * Rule. Both location pickers request a page of locations, and
 * `ListLocationsQueryDto` refuses any `limit` above its `@Max(...)` with a 400.
 * The browser cannot import the DTO (#591), so the number exists twice:
 *
 *   @Max on `limit`               (apps/api/src/inventory/http/dto/list-locations-query.dto.ts)
 *   LOCATION_OPTIONS_PAGE_SIZE    (apps/web/.../stock-and-pricing-section.tsx)
 *   SOURCING_RULE_LOCATION_PAGE_SIZE (apps/web/.../use-inventory-locations-for-rules-query.ts)
 *
 * Each frontend constant MUST be <= the backend cap. Lowering the backend cap
 * alone, or raising a picker alone, turns every read into a 400 that an
 * operator discovers as "Could not open sourcing rules".
 *
 * Files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step. SCOPE: compares the literals only; it does not
 * assert the pickers pass their constant to `listLocations`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND = 'apps/api/src/inventory/http/dto/list-locations-query.dto.ts';
const FRONTEND = [
  ['apps/web/src/features/connections/components/stock-and-pricing-section.tsx', 'LOCATION_OPTIONS_PAGE_SIZE'],
  ['apps/web/src/features/oms/hooks/use-inventory-locations-for-rules-query.ts', 'SOURCING_RULE_LOCATION_PAGE_SIZE'],
];

/** `const <name> = <integer>;`, ignoring any `export` prefix. */
export function readIntConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(source);
  return match ? Number(match[1]) : null;
}

/** The `@Max(n)` that immediately precedes the `limit` property. */
export function readLimitMax(source) {
  const match = /@Max\(\s*(\d+)\s*\)\s*limit\s*\??\s*:/.exec(source);
  return match ? Number(match[1]) : null;
}

function selfCheck() {
  const checks = [
    [readIntConst('const A = 20;', 'A'), 20],
    [readIntConst('export const A  =   7 ;', 'A'), 7],
    [readIntConst('const AB = 20;', 'A'), null],
    [readIntConst('const A = limit;', 'A'), null],
    [readLimitMax('@Min(1)\n  @Max(100)\n  limit?: number = 25;'), 100],
    [readLimitMax('@Max(5)\n  page?: number;\n @Max(100)\n limit?: number'), 100],
    [readLimitMax('@Max(5)\n  page?: number;'), null],
  ];
  checks.forEach(([actual, expected], i) => {
    if (actual !== expected) {
      console.error(`check-location-page-size-mirror --self-check FAILED: case ${i} returned ${actual}, expected ${expected}`);
      process.exit(1);
    }
  });
  console.log('check-location-page-size-mirror --self-check: readers behave');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const cap = readLimitMax(await readFile(join(repoRoot, BACKEND), 'utf8'));
const failures = [];
if (cap === null) {
  failures.push(`${BACKEND}: no @Max(n) directly above \`limit\` found (renamed, removed, or reordered?)`);
}
for (const [file, name] of FRONTEND) {
  const value = readIntConst(await readFile(join(repoRoot, file), 'utf8'), name);
  if (value === null) {
    failures.push(`${file}: ${name} not found as an integer literal (renamed, removed, or made non-literal?)`);
  } else if (cap !== null && value > cap) {
    failures.push(
      `${file}: ${name} = ${value} exceeds the backend cap of ${cap}.\n` +
        `  ${BACKEND} rejects any larger \`limit\` with a 400, so the picker's read would fail on load.`
    );
  }
}

if (failures.length > 0) {
  console.error('check-location-page-size-mirror FAILED:\n');
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`check-location-page-size-mirror: both pickers within the backend cap of ${cap}`);
