#!/usr/bin/env node
/**
 * check-job-outcome-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the sync-job
 * outcome-reason vocabulary (#1689, extended by #3415 and #3651; guard added
 * on the #3661 review).
 *
 * The authoritative declaration is `JobOutcomeReasonValues` in
 *   libs/core/src/sync/domain/types/sync-job.types.ts
 * and the mirror is `JOB_OUTCOME_REASON_VALUES` in
 *   apps/web/src/features/sync-jobs/api/sync-jobs.types.ts
 * which re-declares the vocabulary because the browser bundle does not depend
 * on `@openlinker/core` (#591).
 *
 * WHY A SCRIPT AND NOT JUST THE COMPILER. The badge's `OUTCOME_REASON_LABEL`
 * is a `Record<JobOutcomeReason, string>`, so the mirror -> label direction is
 * already compile-checked. The unguarded direction is core -> mirror: a reason
 * core adds and the mirror lacks is a clean compile on both sides, and the
 * badge's lookup falls back to the generic "business failure" label — which is
 * exactly the undifferentiated state these codes exist to replace. A drifted
 * mirror would silently reinstate that, with nothing red anywhere.
 *
 * ONE RULE — MEMBERSHIP equality, deliberately NOT order. The array renders no
 * control; it derives a union type and keys a label map, both order-independent.
 *
 * WHAT THIS DOES NOT CATCH:
 *
 *   1. It compares the two ARRAYS only. The label map is kept total by its own
 *      `Record<JobOutcomeReason, string>` annotation, a compile error rather
 *      than a lint one.
 *   2. It says nothing about whether a reason is REACHABLE — that is the
 *      handlers' unit specs' job.
 *   3. `JOB_TYPE_VALUES` (same frontend file) is deliberately NOT mirrored: it
 *      is a curated filter list of the job types an operator can pick, not a
 *      copy of core's full job-type vocabulary.
 *   4. It is textual — no TypeScript parse — so it stays a zero-dependency
 *      `check:invariants` step. Line and block comments are stripped before
 *      comparison, which matters because both arrays carry inline comments.
 *
 * "MATCHED NOTHING" is a FAILURE here, not a pass: a missing or empty
 * declaration on either side (a rename, a moved file) exits non-zero rather
 * than silently comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-job-outcome-reason-mirror.mjs
 *   node scripts/check-job-outcome-reason-mirror.mjs --self-check
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
  'sync-jobs.types.ts'
);

/** The two `as const` arrays, which deliberately do NOT share a name. */
const CORE_DECLARATION = 'JobOutcomeReasonValues';
const FRONTEND_DECLARATION = 'JOB_OUTCOME_REASON_VALUES';

/**
 * Strip line and block comments so a commented entry cannot be read as a value.
 *
 * Textual and not quote-aware — the same documented limit its siblings carry.
 * Both inputs are repo-owned `as const` arrays of bare snake_case reason codes,
 * none of which can contain a `//` or a block-comment opener.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract the string literals of `export const <name> = [...] as const;`. */
export function parseReasonValues(content, name) {
  // Strip BEFORE locating the brackets: a `]` or a quote inside one of the
  // per-value comments would otherwise close the array early or invent a value.
  const stripped = stripComments(content);

  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(stripped);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = stripped.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripped.slice(openBracket + 1, closeBracket);

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) values.push(m[1] ?? m[2]);
  return values;
}

/** Compare two vocabularies by MEMBERSHIP, both directions. Empty result means they agree. */
export function diffVocabularies(coreValues, mirrorValues) {
  const problems = [];
  for (const value of coreValues.filter((v) => !mirrorValues.includes(v))) {
    problems.push(`'${value}' is declared in core but MISSING from the frontend mirror`);
  }
  for (const value of mirrorValues.filter((v) => !coreValues.includes(v))) {
    problems.push(`'${value}' is in the frontend mirror but NOT declared in core`);
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
    'parses the core declaration',
    parseReasonValues(`export const ${CORE_DECLARATION} = ['a', 'b'] as const;`, CORE_DECLARATION),
    ['a', 'b']
  );
  expect(
    'parses the differently-named mirror',
    parseReasonValues(
      `export const ${FRONTEND_DECLARATION} = ['a'] as const;`,
      FRONTEND_DECLARATION
    ),
    ['a']
  );
  expect(
    'ignores a block-commented entry',
    parseReasonValues(`export const X = ['a', /* 'x' */ 'b'] as const;`, 'X'),
    ['a', 'b']
  );
  // Mirrors the real core array: a line comment carrying an apostrophe and a
  // backticked code must neither add a value nor end the array.
  expect(
    'ignores a line comment with an apostrophe',
    parseReasonValues(`export const X = [\n 'a',\n // order's \`x\` [#1]\n 'b',\n] as const;`, 'X'),
    ['a', 'b']
  );
  expect('reports an absent declaration', parseReasonValues('export const Other = [];', 'X'), null);
  expect('agrees on identical lists', diffVocabularies(['a', 'b'], ['a', 'b']), []);
  expect('detects a value missing from the mirror', diffVocabularies(['a', 'b'], ['a']), [
    "'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('detects a value missing from core', diffVocabularies(['a'], ['a', 'b']), [
    "'b' is in the frontend mirror but NOT declared in core",
  ]);
  // The deliberate non-rule: a reorder is NOT a failure.
  expect('tolerates a reorder by design', diffVocabularies(['a', 'b'], ['b', 'a']), []);

  if (failures.length > 0) {
    console.error('check-job-outcome-reason-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-job-outcome-reason-mirror --self-check passed');
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
    const values = parseReasonValues(content, declaration);
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

  if (problems.length === 0) problems.push(...diffVocabularies(parsed.core, parsed.mirror));

  if (problems.length > 0) {
    console.error('check-job-outcome-reason-mirror FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}  (${CORE_DECLARATION})`);
    console.error(`  mirror: ${FRONTEND_FILE}  (${FRONTEND_DECLARATION})`);
    console.error('\n  Both declarations must list the same reasons (order is not checked).');
    process.exit(1);
  }

  console.log(`check-job-outcome-reason-mirror OK (${parsed.core.length} reasons)`);
}

await main();
