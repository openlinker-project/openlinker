#!/usr/bin/env node
/**
 * check-hold-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the merged
 * hold-reason vocabulary (#2305 / #2342, ADR-059 adjudication #4).
 *
 * The authoritative declaration is `HoldReasonValues` in
 *   libs/core/src/order-lifecycle/domain/types/hold-reason.types.ts
 * and the mirror is
 *   apps/web/src/features/orders/lib/order-hold.types.ts
 * which re-declares the same exported name because the browser bundle does not
 * depend on `@openlinker/core` (#591).
 *
 * ONE RULE — value + ORDER equality. Membership alone is not enough: the array
 * is what the reason `<Select>` renders, so a reordered mirror silently reorders
 * an operator-facing control while both lists still "agree". Order-sensitivity
 * also matches `check-order-lifecycle-phase-mirror`, whose array order is the
 * phase ordinal; keeping the two guards the same strength means a reader does
 * not have to remember which of the two neighbouring vocabularies is strict.
 *
 * WHAT THIS DOES NOT CATCH. An overstated gate is worse than none:
 *
 *   1. It compares the two ARRAYS only. `HOLD_REASON_COPY` is NOT read here —
 *      that table is kept honest by `satisfies Record<HoldReason, …>`, which is
 *      a compile error rather than a lint one, and duplicating the check would
 *      give the rule two places to drift.
 *   2. It says nothing about the SQL side. There is no hold-reason predicate
 *      table to mirror: `?phase=held` tests `activeHoldReason IS NOT NULL` and
 *      the `?hold=` filter compares the column to a validated request value,
 *      so no third restatement of this vocabulary exists to guard.
 *   3. It is textual — no TypeScript parse, no transpile — so it stays a
 *      zero-dependency `check:invariants` step like its siblings. Line and
 *      block comments are stripped before comparison.
 *
 * "MATCHED NOTHING" is a FAILURE here, not a pass: a missing declaration in
 * either file (a rename, a moved file) exits non-zero rather than silently
 * comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-hold-reason-mirror.mjs
 *   node scripts/check-hold-reason-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'order-lifecycle',
  'domain',
  'types',
  'hold-reason.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'orders',
  'lib',
  'order-hold.types.ts',
);

/** The `as const` array this script treats as authoritative, by name. */
const DECLARATION = 'HoldReasonValues';

const DOCS_REF = 'docs/architecture/adrs/059-order-lifecycle-derived-phase.md';

/**
 * Strip line and block comments so an annotated entry cannot be read as a value.
 *
 * Textual and not quote-aware — the same documented limit its sibling carries.
 * Both inputs are repo-owned `as const` arrays of bare kebab-case reason names,
 * none of which can contain a `//` or `/*` sequence, which is what makes the
 * simple pass adequate.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`.
 * Returns `string[]`, or `null` when the declaration is absent.
 */
export function parseReasonValues(content, name = DECLARATION) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }
  return values;
}

/**
 * Compare two ordered vocabularies. Returns a list of human-readable problems;
 * empty means they agree.
 */
export function diffVocabularies(coreValues, mirrorValues) {
  const problems = [];

  const missing = coreValues.filter((v) => !mirrorValues.includes(v));
  const extra = mirrorValues.filter((v) => !coreValues.includes(v));

  for (const value of missing) {
    problems.push(`'${value}' is declared in core but MISSING from the frontend mirror`);
  }
  for (const value of extra) {
    problems.push(`'${value}' is in the frontend mirror but NOT declared in core`);
  }

  if (problems.length === 0 && coreValues.join('|') !== mirrorValues.join('|')) {
    problems.push(
      `order differs — core: [${coreValues.join(', ')}] / mirror: [${mirrorValues.join(', ')}]`,
    );
  }

  return problems;
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
  };

  expect(
    'parses a simple declaration',
    parseReasonValues(`export const ${DECLARATION} = ['a', 'b'] as const;`),
    ['a', 'b'],
  );
  expect(
    'ignores a commented-out entry',
    parseReasonValues(`export const ${DECLARATION} = ['a', /* 'x' */ 'b'] as const;`),
    ['a', 'b'],
  );
  expect(
    'ignores a line-commented entry',
    parseReasonValues(`export const ${DECLARATION} = [\n 'a',\n // 'x',\n 'b',\n] as const;`),
    ['a', 'b'],
  );
  expect('reports an absent declaration', parseReasonValues('export const Other = [];'), null);
  expect('agrees on identical lists', diffVocabularies(['a', 'b'], ['a', 'b']), []);
  expect('detects a missing value', diffVocabularies(['a', 'b'], ['a']), [
    "'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('detects an extra value', diffVocabularies(['a'], ['a', 'b']), [
    "'b' is in the frontend mirror but NOT declared in core",
  ]);
  expect('detects a reorder', diffVocabularies(['a', 'b'], ['b', 'a']), [
    'order differs — core: [a, b] / mirror: [b, a]',
  ]);

  if (failures.length > 0) {
    console.error('check-hold-reason-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-hold-reason-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const parsed = {};

  for (const [label, relPath] of [
    ['core', CORE_FILE],
    ['mirror', FRONTEND_FILE],
  ]) {
    let content;
    try {
      content = await readFile(join(repoRoot, relPath), 'utf8');
    } catch {
      problems.push(`${relPath} could not be read — did the file move?`);
      continue;
    }
    const values = parseReasonValues(content);
    if (values === null) {
      problems.push(`${relPath} declares no \`export const ${DECLARATION} = [...]\``);
      continue;
    }
    if (values.length === 0) {
      problems.push(`${relPath} declares an EMPTY ${DECLARATION} — a gate that matches nothing`);
      continue;
    }
    parsed[label] = values;
  }

  if (problems.length === 0) {
    problems.push(...diffVocabularies(parsed.core, parsed.mirror));
  }

  if (problems.length > 0) {
    console.error(`check-hold-reason-mirror FAILED (${DOCS_REF}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}`);
    console.error(`  mirror: ${FRONTEND_FILE}`);
    console.error('\n  Both declarations must list the same reasons in the same order.');
    process.exit(1);
  }

  console.log(`check-hold-reason-mirror OK (${parsed.core.length} reasons)`);
}

await main();
