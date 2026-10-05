#!/usr/bin/env node
/**
 * check-bench-label-replace-mirror.mjs
 *
 * Lint-time invariant for the browser's copy of the bench replace-label
 * ceilings (#3664 review).
 *
 * Rule. The bench "Change size" form validates a box in cm and kg, and the
 * replace-label route refuses anything above its `@Max(...)` ceilings, in mm
 * and grams, with a 400. The browser cannot import the DTO (#591), so each
 * ceiling exists twice:
 *
 *   REPLACE_LABEL_MAX_DIMENSION_MM / REPLACE_LABEL_MAX_WEIGHT_GRAMS
 *       (apps/api/src/bench/http/dto/replace-label.dto.ts)
 *   MAX_SIDE_CM / MAX_WEIGHT_KG
 *       (apps/web/src/features/bench/lib/bench-label-replace.ts)
 *
 * Each frontend ceiling, converted to the wire unit the way the form converts
 * it (`cmToMm` = x10, `kgToGrams` = x1000), MUST be <= the backend ceiling.
 * The asymmetry is one-sided: a stricter form costs nothing, a looser one lets
 * a packer submit a value the server answers with "That did not go through".
 * The conversion factors are read from the frontend too, so changing a unit
 * there without updating this rule fails rather than passing on stale maths.
 *
 * Files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step. SCOPE: compares the literals and that each DTO
 * ceiling is referenced by an `@Max(...)`; it does not assert which property
 * each `@Max` decorates.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND = 'apps/api/src/bench/http/dto/replace-label.dto.ts';
const FRONTEND = 'apps/web/src/features/bench/lib/bench-label-replace.ts';

/** `const <name> = <integer>;` (numeric separators allowed), ignoring any `export` prefix. */
export function readIntConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d[\\d_]*)\\s*;`).exec(source);
  return match ? Number(match[1].replaceAll('_', '')) : null;
}

/** The integer factor in `const <name> = (<arg>: number): number => Math.round(<arg> * <factor>);`. */
export function readConversionFactor(source, name) {
  const match = new RegExp(
    `const\\s+${name}\\s*=\\s*\\(\\s*(\\w+)\\s*:\\s*number\\s*\\)\\s*:\\s*number\\s*=>\\s*Math\\.round\\(\\s*\\1\\s*\\*\\s*(\\d[\\d_]*)\\s*\\)`
  ).exec(source);
  return match ? Number(match[2].replaceAll('_', '')) : null;
}

/** How many `@Max(<name>)` decorators reference the constant. */
export function countMaxUses(source, name) {
  return (source.match(new RegExp(`@Max\\(\\s*${name}\\s*\\)`, 'g')) ?? []).length;
}

function selfCheck() {
  const checks = [
    [readIntConst('export const A = 3000;', 'A'), 3000],
    [readIntConst('export const A = 100_000;', 'A'), 100000],
    [readIntConst('const AB = 20;', 'A'), null],
    [readIntConst('const A = B * 10;', 'A'), null],
    [readConversionFactor('export const cmToMm = (cm: number): number => Math.round(cm * 10);', 'cmToMm'), 10],
    [readConversionFactor('export const kgToGrams = (kg: number): number => Math.round(kg * 1000);', 'kgToGrams'), 1000],
    [readConversionFactor('export const cmToMm = (cm: number): number => cm * 10;', 'cmToMm'), null],
    [countMaxUses('@Max(A)\n x;\n @Max( A )\n y;\n @Max(AB)', 'A'), 2],
    [countMaxUses('@Max(3000)', 'A'), 0],
  ];
  checks.forEach(([actual, expected], i) => {
    if (actual !== expected) {
      console.error(`check-bench-label-replace-mirror --self-check FAILED: case ${i} returned ${actual}, expected ${expected}`);
      process.exit(1);
    }
  });
  console.log('check-bench-label-replace-mirror --self-check: readers behave');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const backend = await readFile(join(repoRoot, BACKEND), 'utf8');
const frontend = await readFile(join(repoRoot, FRONTEND), 'utf8');

// [frontend ceiling, frontend conversion fn, backend ceiling, @Max uses expected]
const PAIRS = [
  ['MAX_SIDE_CM', 'cmToMm', 'REPLACE_LABEL_MAX_DIMENSION_MM', 3],
  ['MAX_WEIGHT_KG', 'kgToGrams', 'REPLACE_LABEL_MAX_WEIGHT_GRAMS', 1],
];

const failures = [];
const report = [];
for (const [feName, convName, beName, maxUses] of PAIRS) {
  const feValue = readIntConst(frontend, feName);
  const factor = readConversionFactor(frontend, convName);
  const beValue = readIntConst(backend, beName);
  const uses = countMaxUses(backend, beName);

  // Rule #3303: a reader that parsed nothing must fail, never pass vacuously.
  if (feValue === null) failures.push(`${FRONTEND}: ${feName} not found as an integer literal (renamed, removed, or made non-literal?)`);
  if (factor === null) failures.push(`${FRONTEND}: ${convName} not found as \`Math.round(x * <integer>)\` (the unit conversion changed shape?)`);
  if (beValue === null) failures.push(`${BACKEND}: ${beName} not found as an integer literal (renamed, removed, or made non-literal?)`);
  if (uses < maxUses) {
    failures.push(`${BACKEND}: expected ${maxUses} @Max(${beName}) decorator(s), found ${uses} (the ceiling no longer gates the body?)`);
  }
  if (feValue !== null && factor !== null && beValue !== null) {
    const wire = feValue * factor;
    if (wire > beValue) {
      failures.push(
        `${FRONTEND}: ${feName} = ${feValue} is ${wire} on the wire (${convName}), above ${beName} = ${beValue}.\n` +
          `  The form would accept a value ${BACKEND} rejects with a 400.`
      );
    }
    report.push(`${feName} ${feValue} -> ${wire} <= ${beName} ${beValue}`);
  }
}

if (failures.length > 0) {
  console.error('check-bench-label-replace-mirror FAILED:\n');
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`check-bench-label-replace-mirror: ${report.join('; ')}`);
