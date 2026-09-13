#!/usr/bin/env node
/**
 * check-auto-applied-limit-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * auto-applied page limit (#3168 round-3 review).
 *
 * Rule. These two constants
 *   DEFAULT_AUTO_APPLIED_LIMIT  (apps/api/src/listings/http/price-changes.controller.ts)
 *   AUTO_APPLIED_ITEM_LIMIT     (apps/web/src/features/price-changes/lib/auto-applied-count-label.ts)
 * MUST hold the same number.
 *
 * The browser bundle does not depend on `@openlinker/core` and cannot import
 * from `apps/api` at all (#591), so the number exists twice - the same
 * constraint check-stock-and-pricing-preview-mirror.mjs and
 * check-shipping-tax-split-mirror.mjs live under, and this script follows
 * their shape.
 *
 * Why it matters rather than being tidy: the API returns at most
 * DEFAULT_AUTO_APPLIED_LIMIT entries, and the note renders `N+` once it holds
 * that many, meaning "at least this many, possibly more". Raise the backend
 * limit alone and the note silently stops capping - it renders an exact count
 * that is really a page size. Lower it alone and the note claims "20+" for a
 * page that can never exceed, say, 10, overstating the operator's backlog.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * SCOPE, so the wrong guard is not trusted: this compares the two literals and
 * nothing else. It does NOT assert that the controller actually passes its
 * constant to `listAutoApplied`, nor that the component actually calls
 * `formatAutoAppliedCount`. A refactor that keeps both numbers and stops using
 * one of them passes.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND = 'apps/api/src/listings/http/price-changes.controller.ts';
const FRONTEND = 'apps/web/src/features/price-changes/lib/auto-applied-count-label.ts';

/**
 * Reads `const <name> = <integer>;`, ignoring any `export` prefix so the two
 * sides may differ on visibility (the backend's is file-local, the frontend's
 * is exported for its own tests).
 */
function readIntConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(source);
  return match ? Number(match[1]) : null;
}

function selfCheck() {
  const cases = [
    ['const A = 20;', 'A', 20],
    ['export const A = 20;', 'A', 20],
    ['export const A  =   7 ;', 'A', 7],
    ['const AB = 20;', 'A', null], // must not match a longer name by prefix
    ['const A = limit;', 'A', null], // non-literal is not a number we can compare
    ['// const A = 20;', 'A', 20], // KNOWN: a commented-out declaration still matches
  ];
  for (const [source, name, expected] of cases) {
    const actual = readIntConst(source, name);
    if (actual !== expected) {
      console.error(
        `check-auto-applied-limit-mirror --self-check FAILED: readIntConst(${JSON.stringify(source)}, '${name}') ` +
          `returned ${actual}, expected ${expected}`
      );
      process.exit(1);
    }
  }
  console.log('check-auto-applied-limit-mirror --self-check: reader behaves');
}

selfCheck();

const backendSource = await readFile(join(repoRoot, BACKEND), 'utf8');
const frontendSource = await readFile(join(repoRoot, FRONTEND), 'utf8');

const backendLimit = readIntConst(backendSource, 'DEFAULT_AUTO_APPLIED_LIMIT');
const frontendLimit = readIntConst(frontendSource, 'AUTO_APPLIED_ITEM_LIMIT');

const failures = [];
if (backendLimit === null) {
  failures.push(`${BACKEND}: DEFAULT_AUTO_APPLIED_LIMIT not found as an integer literal (renamed, removed, or made non-literal?)`);
}
if (frontendLimit === null) {
  failures.push(`${FRONTEND}: AUTO_APPLIED_ITEM_LIMIT not found as an integer literal (renamed, removed, or made non-literal?)`);
}
if (backendLimit !== null && frontendLimit !== null && backendLimit !== frontendLimit) {
  failures.push(
    `the auto-applied limit has drifted.\n` +
      `  ${BACKEND}: DEFAULT_AUTO_APPLIED_LIMIT = ${backendLimit}\n` +
      `  ${FRONTEND}: AUTO_APPLIED_ITEM_LIMIT = ${frontendLimit}\n` +
      `  The note renders "N+" at exactly this count; a mismatch makes it either\n` +
      `  stop capping or claim a backlog the page can never contain.`
  );
}

if (failures.length > 0) {
  console.error('check-auto-applied-limit-mirror FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log(`check-auto-applied-limit-mirror: limit ${backendLimit} in sync across both sides`);
