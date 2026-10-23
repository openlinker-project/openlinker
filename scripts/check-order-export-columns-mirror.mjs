#!/usr/bin/env node
/**
 * check-order-export-columns-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the orders
 * export column vocabulary (#3534, #3507 U1).
 *
 * The authoritative declarations live in
 *   libs/core/src/orders/domain/order-export-columns.ts
 * and the mirror is
 *   apps/web/src/features/orders/api/orders.types.ts
 * which re-declares the same exported names because the browser bundle does
 * not depend on `@openlinker/core` (#591).
 *
 * FOUR RULES, one per declaration:
 *
 *   1. `ORDER_EXPORT_COLUMN_IDS` — value + ORDER equality. The order is the
 *      default column order of the file, so a reordered mirror would put the
 *      dialog's "All columns" preset out of step with the job.
 *   2. `ORDER_EXPORT_DEFAULT_COLUMNS` — value + ORDER equality. The dialog
 *      starts from this set; drift means it shows ticked a set the job would
 *      not write when no columns are sent (the exact U1 defect).
 *   3. `ORDER_EXPORT_PII_COLUMNS` — value + ORDER equality. The dialog's
 *      personal-data warning keys on it; a column added only in core would be
 *      blanked by the job without the dialog ever warning about it.
 *   4. `ORDER_EXPORT_COLUMN_LABELS` — key -> label equality, order-INDEPENDENT
 *      (an object literal's key order is presentational).
 *
 * WHAT THIS DOES NOT CATCH:
 *
 *   - It is textual — no TypeScript parse — so it stays a zero-dependency
 *     `check:invariants` step like its siblings. Comments are blanked first.
 *   - The FE-only groupings and built-in presets
 *     (`features/orders/lib/order-export-columns.ts`) are not compared with
 *     anything: core has no counterpart. They are typed against
 *     `OrderExportColumnIdValue`, so a removed id there is a compile error.
 *
 * "MATCHED NOTHING" is a FAILURE: a missing or empty declaration in either
 * file exits non-zero rather than comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-order-export-columns-mirror.mjs
 *   node scripts/check-order-export-columns-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join('libs', 'core', 'src', 'orders', 'domain', 'order-export-columns.ts');
const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');

const ARRAY_DECLARATIONS = [
  'ORDER_EXPORT_COLUMN_IDS',
  'ORDER_EXPORT_DEFAULT_COLUMNS',
  'ORDER_EXPORT_PII_COLUMNS',
];
const LABELS_DECLARATION = 'ORDER_EXPORT_COLUMN_LABELS';

/**
 * Blank `//` and block comments to spaces (newlines preserved) so a bracket or
 * quote inside a comment is never read as code. Length-preserving.
 */
export function blankComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The string literals of `export const <name>(: <type>)? = [...]`, or `null`
 * when the declaration is absent. The optional annotation covers core's
 * `readonly OrderExportColumnId[]` form; it holds no `=`, so `[^=]*` is safe.
 */
export function parseArray(content, name) {
  const source = blankComments(content);
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]*)?=\\s*\\[`);
  const declMatch = declRe.exec(source);
  if (!declMatch) return null;
  const open = declMatch.index + declMatch[0].length - 1;
  const close = source.indexOf(']', open);
  if (close === -1) return null;
  const body = source.slice(open + 1, close);
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) values.push(m[1] ?? m[2]);
  return values;
}

/** `key: 'label'` pairs of `export const <name>(: <type>)? = { ... }`, or `null`. */
export function parseLabels(content, name) {
  const source = blankComments(content);
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]*)?=\\s*\\{`);
  const declMatch = declRe.exec(source);
  if (!declMatch) return null;
  const open = declMatch.index + declMatch[0].length - 1;
  const close = source.indexOf('}', open);
  if (close === -1) return null;
  const body = source.slice(open + 1, close);
  const pairs = {};
  const pairRe = /([A-Za-z_$][\w$]*)\s*:\s*(?:'([^']*)'|"([^"]*)")/g;
  let m;
  while ((m = pairRe.exec(body)) !== null) pairs[m[1]] = m[2] ?? m[3];
  return pairs;
}

export function diffOrdered(name, coreValues, mirrorValues) {
  const problems = [];
  for (const v of coreValues.filter((x) => !mirrorValues.includes(x))) {
    problems.push(`${name}: '${v}' is declared in core but MISSING from the frontend mirror`);
  }
  for (const v of mirrorValues.filter((x) => !coreValues.includes(x))) {
    problems.push(`${name}: '${v}' is in the frontend mirror but NOT declared in core`);
  }
  if (problems.length === 0 && coreValues.join('|') !== mirrorValues.join('|')) {
    problems.push(
      `${name}: order differs — core: [${coreValues.join(', ')}] / mirror: [${mirrorValues.join(', ')}]`,
    );
  }
  return problems;
}

export function diffLabels(name, core, mirror) {
  const problems = [];
  for (const key of Object.keys(core)) {
    if (!(key in mirror)) problems.push(`${name}: '${key}' is labelled in core but MISSING from the mirror`);
    else if (core[key] !== mirror[key]) {
      problems.push(`${name}: '${key}' is '${core[key]}' in core but '${mirror[key]}' in the mirror`);
    }
  }
  for (const key of Object.keys(mirror)) {
    if (!(key in core)) problems.push(`${name}: '${key}' is labelled in the mirror but NOT in core`);
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

  expect('parses an as-const array', parseArray(`export const X = ['a', 'b'] as const;`, 'X'), ['a', 'b']);
  expect(
    'parses a type-annotated array',
    parseArray(`export const X: readonly Id[] = [\n  'a',\n  'b',\n];`, 'X'),
    ['a', 'b'],
  );
  expect(
    'ignores a commented-out entry',
    parseArray(`export const X = ['a', /* 'x' */ 'b', // 'y'\n] as const;`, 'X'),
    ['a', 'b'],
  );
  expect(
    'a "]" inside a comment does not truncate the array',
    parseArray(`export const X = [\n  'a', // e.g. []\n  'b',\n];`, 'X'),
    ['a', 'b'],
  );
  expect('reports an absent array', parseArray('export const Y = [];', 'X'), null);
  expect(
    'parses a labels record',
    parseLabels(`export const L: Record<Id, string> = {\n  a: 'Alpha',\n  b: "Beta", // c: 'x'\n};`, 'L'),
    { a: 'Alpha', b: 'Beta' },
  );
  expect('reports absent labels', parseLabels('export const M = {};', 'L'), null);
  expect('ordered: agrees', diffOrdered('X', ['a', 'b'], ['a', 'b']), []);
  expect('ordered: missing', diffOrdered('X', ['a', 'b'], ['a']), [
    "X: 'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('ordered: extra', diffOrdered('X', ['a'], ['a', 'b']), [
    "X: 'b' is in the frontend mirror but NOT declared in core",
  ]);
  expect('ordered: reorder', diffOrdered('X', ['a', 'b'], ['b', 'a']), [
    'X: order differs — core: [a, b] / mirror: [b, a]',
  ]);
  expect('labels: agree regardless of order', diffLabels('L', { a: '1', b: '2' }, { b: '2', a: '1' }), []);
  expect('labels: changed text', diffLabels('L', { a: '1' }, { a: '2' }), [
    "L: 'a' is '1' in core but '2' in the mirror",
  ]);
  expect('labels: extra key', diffLabels('L', {}, { a: '1' }), [
    "L: 'a' is labelled in the mirror but NOT in core",
  ]);

  if (failures.length > 0) {
    console.error('check-order-export-columns-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-order-export-columns-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const contents = {};
  for (const [label, relPath] of [
    ['core', CORE_FILE],
    ['mirror', FRONTEND_FILE],
  ]) {
    try {
      contents[label] = await readFile(join(repoRoot, relPath), 'utf8');
    } catch {
      problems.push(`${relPath} could not be read — did the file move?`);
    }
  }

  if (problems.length === 0) {
    for (const name of ARRAY_DECLARATIONS) {
      const core = parseArray(contents.core, name);
      const mirror = parseArray(contents.mirror, name);
      if (core === null || mirror === null) {
        problems.push(`${name} is not declared in ${core === null ? CORE_FILE : FRONTEND_FILE}`);
        continue;
      }
      if (core.length === 0 || mirror.length === 0) {
        problems.push(`${name} is EMPTY in ${core.length === 0 ? CORE_FILE : FRONTEND_FILE} — a gate that matches nothing`);
        continue;
      }
      problems.push(...diffOrdered(name, core, mirror));
    }
    const coreLabels = parseLabels(contents.core, LABELS_DECLARATION);
    const mirrorLabels = parseLabels(contents.mirror, LABELS_DECLARATION);
    if (coreLabels === null || mirrorLabels === null) {
      problems.push(
        `${LABELS_DECLARATION} is not declared in ${coreLabels === null ? CORE_FILE : FRONTEND_FILE}`,
      );
    } else if (Object.keys(coreLabels).length === 0 || Object.keys(mirrorLabels).length === 0) {
      problems.push(`${LABELS_DECLARATION} parsed to zero entries — a gate that matches nothing`);
    } else {
      problems.push(...diffLabels(LABELS_DECLARATION, coreLabels, mirrorLabels));
    }
  }

  if (problems.length > 0) {
    console.error('check-order-export-columns-mirror FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}`);
    console.error(`  mirror: ${FRONTEND_FILE}`);
    process.exit(1);
  }

  console.log(
    `check-order-export-columns-mirror OK (${ARRAY_DECLARATIONS.length} lists + labels)`,
  );
}

await main();
