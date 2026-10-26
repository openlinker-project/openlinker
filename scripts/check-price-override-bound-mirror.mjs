#!/usr/bin/env node
/**
 * check-price-override-bound-mirror.mjs
 *
 * Lint-time invariant tying the SERVER's price-override bound to the
 * BROWSER's deviation warning (#3236 review).
 *
 * Rule. The server band must strictly CONTAIN the browser band:
 *
 *   1 + DEVIATION_WARN_THRESHOLD  <  PRICE_OVERRIDE_MAX_FACTOR
 *
 *   DEVIATION_WARN_THRESHOLD  (apps/web/src/features/price-changes/components/edit-price-change-dialog.tsx)
 *   PRICE_OVERRIDE_MAX_FACTOR (libs/core/src/listings/domain/types/price-override-bound.types.ts)
 *
 * Why it matters: the form warns at ±30% and lets the operator publish anyway,
 * while the server refuses past the factor. If the server band were ever
 * narrower, the form would invite a submit the server then rejects — a mirror
 * stricter than the gate, which #2240 records as refusing work the destination
 * would have accepted.
 *
 * Why a script rather than a test: `apps/web` cannot import `@openlinker/core`
 * (#591), so the two numbers live in two files with no type connecting them.
 * The spec beside the core constant hardcoded its own copy of the browser
 * threshold, which pinned exactly one side — editing the browser constant
 * failed nothing. This is the same answer the repo already gives for a
 * browser-side pricing mirror of a core rule
 * (`check-stock-and-pricing-preview-mirror.mjs`), and it follows that file's
 * shape.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * SCOPE, so the wrong guard is not trusted: it compares the two literals and
 * nothing else. It does NOT assert that the dialog still uses its threshold to
 * warn, nor that `PriceChangesService.edit` still calls
 * `checkPriceOverrideBound`. A refactor that keeps both numbers and stops
 * consulting one of them passes.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BROWSER = 'apps/web/src/features/price-changes/components/edit-price-change-dialog.tsx';
const CORE = 'libs/core/src/listings/domain/types/price-override-bound.types.ts';

/** Reads `const <name> = <number>;`, tolerating `export` and `_` separators. */
function readNumericConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([\\d_]*\\.?[\\d_]+)\\s*;`).exec(source);
  return match ? Number(match[1].replace(/_/g, '')) : null;
}

function selfCheck() {
  const cases = [
    ['const A = 0.3;', 'A', 0.3],
    ['export const A = 10;', 'A', 10],
    ['export const A = 1_000;', 'A', 1000],
    ['const AB = 10;', 'A', null], // must not match a longer name by prefix
    ['const A = factor;', 'A', null], // non-literal is not comparable
  ];
  for (const [source, name, expected] of cases) {
    const actual = readNumericConst(source, name);
    if (actual !== expected) {
      console.error(
        `check-price-override-bound-mirror --self-check FAILED: readNumericConst(${JSON.stringify(source)}, '${name}') ` +
          `returned ${actual}, expected ${expected}`
      );
      process.exit(1);
    }
  }
  // The comparison itself, so a rewrite of the inequality is caught too.
  const contains = (browser, core) => 1 + browser < core;
  for (const [browser, core, expected] of [
    [0.3, 10, true],
    [0.3, 1.3, false], // equal band — the form could submit what the server refuses
    [0.3, 1.2, false],
    [9.5, 10, false],
  ]) {
    if (contains(browser, core) !== expected) {
      console.error('check-price-override-bound-mirror --self-check FAILED: containment rule is wrong');
      process.exit(1);
    }
  }
  console.log('check-price-override-bound-mirror --self-check: reader + containment rule behave');
}

selfCheck();

const browserSource = await readFile(join(repoRoot, BROWSER), 'utf8');
const coreSource = await readFile(join(repoRoot, CORE), 'utf8');

const browser = readNumericConst(browserSource, 'DEVIATION_WARN_THRESHOLD');
const core = readNumericConst(coreSource, 'PRICE_OVERRIDE_MAX_FACTOR');

const failures = [];
if (browser === null) {
  failures.push(`${BROWSER}: DEVIATION_WARN_THRESHOLD not found as a numeric literal (renamed, removed, or computed?)`);
}
if (core === null) {
  failures.push(`${CORE}: PRICE_OVERRIDE_MAX_FACTOR not found as a numeric literal (renamed, removed, or computed?)`);
}
if (browser !== null && core !== null && !(1 + browser < core)) {
  failures.push(
    `the server band no longer contains the browser band.\n` +
      `  ${BROWSER}: DEVIATION_WARN_THRESHOLD = ${browser}  (form warns past x${(1 + browser).toFixed(2)} and publishes anyway)\n` +
      `  ${CORE}: PRICE_OVERRIDE_MAX_FACTOR = ${core}  (server refuses past x${core})\n` +
      `  A form that can submit what the server refuses is a mirror stricter than\n` +
      `  the gate (#2240) — the operator is invited to confirm, then rejected.`
  );
}

if (failures.length > 0) {
  console.error('check-price-override-bound-mirror FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log(
  `check-price-override-bound-mirror: server x${core} contains browser ±${browser * 100}% (x${(1 + browser).toFixed(2)})`
);
