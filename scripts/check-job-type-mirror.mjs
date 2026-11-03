#!/usr/bin/env node
/**
 * check-job-type-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the sync job
 * type vocabulary (#3507 G03-12).
 *
 * The authoritative declaration is `JobTypeValues` in
 *   libs/core/src/sync/domain/types/sync-job.types.ts
 * and the mirror is `JOB_TYPE_VALUES` in
 *   apps/web/src/features/sync-jobs/api/sync-jobs.types.ts
 * which re-declares the list because the browser bundle does not depend on
 * `@openlinker/core` (#591). The mirror is the Jobs & Logs type filter's
 * option list; it had drifted to 21 of the core's types, so `orders.export`
 * (and every type added since the list was written) could be seen in the
 * job list but never filtered to.
 *
 * ONE RULE — SET equality, order free, no duplicates.
 *
 *   - FE ⊇ core: a core type missing from the mirror is a job an operator can
 *     see but cannot filter to — the defect this guard exists for.
 *   - FE ⊆ core: a value only in the mirror is a filter option the API's
 *     `jobType` query validation rejects, i.e. a dropdown entry that errors.
 *   - Order is NOT compared, unlike `check-hold-reason-mirror`: the core array
 *     is grouped by bounded context and history, the mirror by what reads well
 *     in a dropdown, and neither order carries meaning (no ordinal, no
 *     precedence) — requiring them to match would force one of the two into
 *     an arbitrary shape for no protection.
 *
 * WHAT THIS DOES NOT CATCH:
 *
 *   1. It compares the two ARRAYS only — never a label table (the dropdown
 *      renders the raw type string, so there is none) and never the worker's
 *      handler registrations (`assertFullLaneCoverage()` owns that at boot).
 *   2. It is textual — no TypeScript parse — so it stays a zero-dependency
 *      `check:invariants` step like its siblings. Line and block comments are
 *      stripped before literals are read, so a commented-out entry or a quoted
 *      word inside a comment is never counted.
 *
 * "MATCHED NOTHING" is a FAILURE here, not a pass: a missing or empty
 * declaration in either file (a rename, a moved file) exits non-zero rather
 * than silently comparing two empty sets forever.
 *
 * Usage:
 *   node scripts/check-job-type-mirror.mjs
 *   node scripts/check-job-type-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join('libs', 'core', 'src', 'sync', 'domain', 'types', 'sync-job.types.ts');
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'sync-jobs',
  'api',
  'sync-jobs.types.ts',
);

const CORE_DECLARATION = 'JobTypeValues';
const FRONTEND_DECLARATION = 'JOB_TYPE_VALUES';

/**
 * Strip line and block comments so an annotated entry cannot be read as a value.
 *
 * Textual and not quote-aware — the same documented limit its siblings carry.
 * Both inputs are repo-owned `as const` arrays of dotted job-type names, none
 * of which can contain a `//` or `/*` sequence.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Blank `//` and `/* ... *\/` comments to spaces (newlines preserved), so a `]`
 * written inside a comment can never be mistaken for the array's real closing
 * bracket (#3002). Length-preserving.
 */
function blankComments(source) {
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
 * Extract the string literals of `export const <name> = [...] as const;`.
 * Returns `string[]`, or `null` when the declaration is absent.
 */
export function parseJobTypeValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = blankComments(content).indexOf(']', openBracket);
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
 * Compare the two vocabularies as SETS. Returns human-readable problems; empty
 * means they agree.
 */
export function diffJobTypes(coreValues, mirrorValues) {
  const problems = [];

  for (const [label, values] of [
    ['core', coreValues],
    ['frontend mirror', mirrorValues],
  ]) {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value)) {
        problems.push(`'${value}' is listed more than once in the ${label}`);
      }
      seen.add(value);
    }
  }

  const mirror = new Set(mirrorValues);
  const core = new Set(coreValues);
  for (const value of coreValues) {
    if (!mirror.has(value)) {
      problems.push(`'${value}' is declared in core but MISSING from the frontend mirror`);
    }
  }
  for (const value of mirrorValues) {
    if (!core.has(value)) {
      problems.push(`'${value}' is in the frontend mirror but NOT declared in core`);
    }
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
    parseJobTypeValues(`export const X = ['a.b', 'c.d'] as const;`, 'X'),
    ['a.b', 'c.d'],
  );
  expect(
    'ignores a trailing line comment carrying quotes',
    parseJobTypeValues(`export const X = [\n  'a.b', // OL's own 'legacy' rows\n  'c.d',\n] as const;`, 'X'),
    ['a.b', 'c.d'],
  );
  expect(
    'ignores a block-commented entry',
    parseJobTypeValues(`export const X = ['a.b', /* 'x.y' */ 'c.d'] as const;`, 'X'),
    ['a.b', 'c.d'],
  );
  expect(
    'a "]" inside a comment does not truncate the array',
    parseJobTypeValues(`export const X = [\n  'a.b', // see list[0]\n  'c.d',\n] as const;`, 'X'),
    ['a.b', 'c.d'],
  );
  expect('reports an absent declaration', parseJobTypeValues('export const Y = [];', 'X'), null);
  expect('agrees on identical sets', diffJobTypes(['a', 'b'], ['a', 'b']), []);
  expect('ignores order', diffJobTypes(['a', 'b'], ['b', 'a']), []);
  expect('detects a value missing from the mirror', diffJobTypes(['a', 'b'], ['a']), [
    "'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('detects a value only in the mirror', diffJobTypes(['a'], ['a', 'b']), [
    "'b' is in the frontend mirror but NOT declared in core",
  ]);
  expect('detects a duplicate in the mirror', diffJobTypes(['a'], ['a', 'a']), [
    "'a' is listed more than once in the frontend mirror",
  ]);

  if (failures.length > 0) {
    console.error('check-job-type-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-job-type-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const parsed = {};

  for (const [label, relPath, declaration] of [
    ['core', CORE_FILE, CORE_DECLARATION],
    ['mirror', FRONTEND_FILE, FRONTEND_DECLARATION],
  ]) {
    let content;
    try {
      content = await readFile(join(repoRoot, relPath), 'utf8');
    } catch {
      problems.push(`${relPath} could not be read — did the file move?`);
      continue;
    }
    const values = parseJobTypeValues(content, declaration);
    if (values === null) {
      problems.push(`${relPath} declares no \`export const ${declaration} = [...]\``);
      continue;
    }
    if (values.length === 0) {
      problems.push(`${relPath} declares an EMPTY ${declaration} — a gate that matches nothing`);
      continue;
    }
    parsed[label] = values;
  }

  if (problems.length === 0) {
    problems.push(...diffJobTypes(parsed.core, parsed.mirror));
  }

  if (problems.length > 0) {
    console.error('check-job-type-mirror FAILED (#3507 G03-12):');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE} (${CORE_DECLARATION})`);
    console.error(`  mirror: ${FRONTEND_FILE} (${FRONTEND_DECLARATION})`);
    console.error('\n  Both declarations must list the same job types (order is free).');
    process.exit(1);
  }

  console.log(`check-job-type-mirror OK (${parsed.core.length} job types)`);
}

await main();
