#!/usr/bin/env node
/**
 * check-retry-refusal-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the automation
 * retry-refusal vocabulary (#2387, extended by #2666).
 *
 * The authoritative declaration is `RetryRefusalReasonValues` in
 *   libs/core/src/automation/domain/types/automation-run.types.ts
 * and the mirror is `RETRY_REFUSAL_REASON_VALUES` in
 *   apps/web/src/features/automation/api/automation.types.ts
 * which re-declares the vocabulary because the browser bundle does not depend
 * on `@openlinker/core` (#591).
 *
 * WHY A SCRIPT AND NOT JUST THE COMPILER. `RETRY_REFUSAL_COPY` carries
 * `as const satisfies Record<RetryRefusalReason, string>`, which looks like it
 * already guards this and does not: it is total against the FRONTEND's own
 * type, which is derived from the mirror. Core adding a sixth reason while the
 * mirror stays at five is a clean compile on both sides, and the operator gets
 * a raw kebab-case code where a sentence belongs. #2666 took the vocabulary
 * from three values to five, which is what made the gap worth closing.
 *
 * ONE RULE — MEMBERSHIP equality, deliberately NOT order.
 * `check-hold-reason-mirror` is order-strict because its array is what a reason
 * `<Select>` renders, so a reorder silently reorders an operator-facing control.
 * This array renders nothing: it exists to derive a union type and to key a copy
 * map, both order-independent. Failing a build because someone alphabetised it
 * would be an unjustified gate, and `check-ui-vocabulary` already records why
 * that is worse than none — it trains people to distrust the check.
 *
 * WHAT THIS DOES NOT CATCH. An overstated gate is worse than none:
 *
 *   1. It compares the two ARRAYS only. Neither copy map is read here —
 *      `RETRY_REFUSAL_COPY` (frontend) and `REFUSAL_MESSAGE` (apps/api) are each
 *      kept total by their own `Record<RetryRefusalReason, string>` annotation,
 *      which is a compile error rather than a lint one. Duplicating that here
 *      would give one rule two places to drift.
 *   2. It says nothing about whether a reason is REACHABLE. A value both sides
 *      declare that `resolveRetryEligibility` can never return is invisible to
 *      this check; that is the unit spec's job.
 *   3. It is textual — no TypeScript parse, no transpile — so it stays a
 *      zero-dependency `check:invariants` step like its siblings. Line and
 *      block comments are stripped before comparison, which matters here
 *      because both declarations carry per-value docblocks.
 *
 * "MATCHED NOTHING" is a FAILURE here, not a pass: a missing declaration on
 * either side (a rename, a moved file) exits non-zero rather than silently
 * comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-retry-refusal-reason-mirror.mjs
 *   node scripts/check-retry-refusal-reason-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs', 'core', 'src', 'automation', 'domain', 'types', 'automation-run.types.ts',
);
const FRONTEND_FILE = join(
  'apps', 'web', 'src', 'features', 'automation', 'api', 'automation.types.ts',
);

/** The two `as const` arrays, which deliberately do NOT share a name. */
const CORE_DECLARATION = 'RetryRefusalReasonValues';
const FRONTEND_DECLARATION = 'RETRY_REFUSAL_REASON_VALUES';

const DOCS_REF = 'docs/plans/implementation-plan-automation-retry-chains.md';

/**
 * Strip line and block comments so an annotated entry cannot be read as a value.
 *
 * Textual and not quote-aware — the same documented limit its siblings carry.
 * Both inputs are repo-owned `as const` arrays of bare kebab-case reason names,
 * none of which can contain a `//` or a block-comment opener, which is what
 * makes the simple pass adequate.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract the string literals of `export const <name> = [...] as const;`. */
export function parseReasonValues(content, name) {
  // Strip BEFORE locating the brackets, not after. A `]` inside one of the
  // per-value docblocks (an `[ADR-xxx]` reference is the likely one) would
  // otherwise close the array early and silently shorten the parsed list.
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

/** Compare two vocabularies by MEMBERSHIP. Empty result means they agree. */
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

  expect('parses a simple declaration',
    parseReasonValues(`export const ${CORE_DECLARATION} = ['a', 'b'] as const;`, CORE_DECLARATION),
    ['a', 'b']);
  expect('parses the differently-named mirror',
    parseReasonValues(`export const ${FRONTEND_DECLARATION} = ['a'] as const;`, FRONTEND_DECLARATION),
    ['a']);
  expect('ignores a block-commented entry',
    parseReasonValues(`export const X = ['a', /* 'x' */ 'b'] as const;`, 'X'), ['a', 'b']);
  expect('ignores a line-commented entry',
    parseReasonValues(`export const X = [\n 'a',\n // 'x',\n 'b',\n] as const;`, 'X'), ['a', 'b']);
  // A `]` inside a docblock must not close the array early — comments are
  // stripped before the brackets are located, so this parses both values.
  expect('survives a bracket inside a docblock',
    parseReasonValues(`export const X = ['a', /* see [ADR-041] */ 'b'] as const;`, 'X'),
    ['a', 'b']);
  expect('reports an absent declaration', parseReasonValues('export const Other = [];', 'X'), null);
  expect('agrees on identical lists', diffVocabularies(['a', 'b'], ['a', 'b']), []);
  expect('detects a missing value', diffVocabularies(['a', 'b'], ['a']), [
    "'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('detects an extra value', diffVocabularies(['a'], ['a', 'b']), [
    "'b' is in the frontend mirror but NOT declared in core",
  ]);
  // The deliberate non-rule: a reorder is NOT a failure here. Asserted so a
  // future author cannot tighten it without deleting this line and reading why.
  expect('tolerates a reorder by design', diffVocabularies(['a', 'b'], ['b', 'a']), []);

  if (failures.length > 0) {
    console.error('check-retry-refusal-reason-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-retry-refusal-reason-mirror --self-check passed');
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
    console.error(`check-retry-refusal-reason-mirror FAILED (${DOCS_REF}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}  (${CORE_DECLARATION})`);
    console.error(`  mirror: ${FRONTEND_FILE}  (${FRONTEND_DECLARATION})`);
    console.error('\n  Both declarations must list the same reasons (order is not checked).');
    process.exit(1);
  }

  console.log(`check-retry-refusal-reason-mirror OK (${parsed.core.length} reasons)`);
}

await main();
