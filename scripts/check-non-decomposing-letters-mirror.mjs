#!/usr/bin/env node
/**
 * check-non-decomposing-letters-mirror.mjs
 *
 * Lint-time invariant for the two LIVE copies of the search normalizer's
 * letter map (#3633 review).
 *
 * Rule. Both search normalizers fold the letters NFD does not decompose
 * (`ł` → `l`, `ß` → `ss`, …) with a `NON_DECOMPOSING_LETTERS` table:
 *
 *   libs/core/src/listings/domain/destination-category-search.ts  (destination-category search)
 *   libs/core/src/orders/domain/order-search-text.ts              (`/orders` search)
 *
 * `orders` does not depend on `listings`, and opening a cross-context edge for
 * a short normalizer would cost more than it buys, so the table exists twice.
 * The two MUST hold the same entries in the same order. Drift is quiet: a
 * letter added to one side makes `odziez`-style typing find a record in one
 * search box and not the other, with nothing failing.
 *
 * NOT compared: the copy frozen inside
 * `apps/api/src/migrations/1920000007000-recompute-order-record-search-text.ts`.
 * A migration keeps meaning what it meant when it ran, so that copy must NOT
 * follow later edits to the live pair (`docs/lessons.md`, "A migration
 * backfill must copy application logic, never call it").
 *
 * Files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step. Zero-floor: a side that yields no entries, or an
 * entry the reader cannot parse, fails the check rather than comparing two
 * empty lists as equal.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SOURCES = [
  'libs/core/src/listings/domain/destination-category-search.ts',
  'libs/core/src/orders/domain/order-search-text.ts',
];

const ENTRY = /\[\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)\s*,\s*'((?:\\.|[^'\\\n])*)'\s*\]\s*,?/g;

/**
 * The `NON_DECOMPOSING_LETTERS` array as `pattern/flags => replacement`
 * strings, in source order. Returns `null` when the declaration is missing and
 * `{ error }` when its body holds something that is not a `[/x/g, 'y']` entry.
 */
export function readLetterTable(source) {
  const decl = /const\s+NON_DECOMPOSING_LETTERS\b[^=]*=\s*\[([\s\S]*?)\n\s*\];/.exec(source);
  if (!decl) return null;
  const body = decl[1];
  const entries = [];
  for (const match of body.matchAll(ENTRY)) {
    entries.push(`/${match[1]}/${match[2]} => '${match[3]}'`);
  }
  const residue = body
    .replace(ENTRY, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  if (residue.length > 0) {
    return { error: `unparseable content in the table: ${JSON.stringify(residue.slice(0, 60))}` };
  }
  return { entries };
}

function selfCheck() {
  const table = (body) =>
    `const NON_DECOMPOSING_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [\n${body}\n];`;
  const cases = [
    [
      readLetterTable(table("  [/ł/g, 'l'],\n  [/ß/g, 'ss'],")),
      { entries: ["/ł/g => 'l'", "/ß/g => 'ss'"] },
    ],
    [readLetterTable(table("  [ /ø/g , 'o' ]")), { entries: ["/ø/g => 'o'"] }],
    [readLetterTable(table("  // a comment\n  [/æ/g, 'ae'],")), { entries: ["/æ/g => 'ae'"] }],
    [readLetterTable(table('')), { entries: [] }],
    [readLetterTable(table("  [/ł/g, 'l'],\n  SOMETHING_ELSE,")).error !== undefined, true],
    [readLetterTable('const OTHER = [\n];'), null],
  ];
  cases.forEach(([actual, expected], i) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      console.error(
        `check-non-decomposing-letters-mirror --self-check FAILED: case ${i} returned ` +
          `${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
      );
      process.exit(1);
    }
  });
  console.log('check-non-decomposing-letters-mirror --self-check: reader behaves');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const failures = [];
const tables = [];
for (const file of SOURCES) {
  const parsed = readLetterTable(await readFile(join(repoRoot, file), 'utf8'));
  if (parsed === null) {
    failures.push(
      `${file}: no \`const NON_DECOMPOSING_LETTERS = [ … ];\` found (renamed or removed?)`
    );
  } else if (parsed.error) {
    failures.push(`${file}: ${parsed.error}`);
  } else if (parsed.entries.length === 0) {
    failures.push(`${file}: NON_DECOMPOSING_LETTERS parsed to ZERO entries (reader drift?)`);
  } else {
    tables.push([file, parsed.entries]);
  }
}

if (failures.length === 0) {
  const [[leftFile, left], [rightFile, right]] = tables;
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    failures.push(
      `the two live NON_DECOMPOSING_LETTERS tables differ:\n` +
        `    ${leftFile}:\n      ${left.join('\n      ')}\n` +
        `    ${rightFile}:\n      ${right.join('\n      ')}\n` +
        `  Edit both together (same entries, same order). The migration copy stays frozen.`
    );
  }
}

if (failures.length > 0) {
  console.error('check-non-decomposing-letters-mirror FAILED:\n');
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(
  `check-non-decomposing-letters-mirror OK (${tables[0][1].length} letters, 2 live copies)`
);
