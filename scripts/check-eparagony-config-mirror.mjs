#!/usr/bin/env node
/**
 * check-eparagony-config-mirror.mjs
 *
 * Lint-time invariant for the eparagony.pl connection-config mirror (#3266).
 *
 * The browser bundle does not depend on `@openlinker/core` or on
 * `@openlinker/integrations-eparagony` (#591), so the connection form carries
 * its own copy of the vendor vocabularies and the adapter's poll-timeout clamp.
 * A drifted copy is not cosmetic:
 *
 *   - a payment form the backend no longer accepts stays selectable, and the
 *     save fails with a 400 the operator cannot act on;
 *   - a payment form the backend gained is never offered, so the form silently
 *     refuses a value the destination would take (#2240);
 *   - a rate slot added or removed desynchronises the fallback select;
 *   - the clamp bounds are STATED in the field's description, so a drifted copy
 *     makes that sentence a false claim about what the adapter does - the
 *     "reported drifts from enforced" failure #2229 names;
 *   - the DEFAULT payment form is rendered to the operator twice, as the option
 *     label "Use the default (Przelew)" and as "Defaults to Przelew". Change the
 *     mapper's default and an unguarded mirror would keep asserting the old word
 *     about a label stamped on a fiscal receipt (#3268 review);
 *   - `OL_TAX_RATE_STRICT_ENABLED` is NAMED in the tax-fallback infotip, and
 *     core exports `TAX_RATE_STRICT_ENV_VAR` precisely "so the rollout runbook
 *     and the code cannot drift on the spelling". A sentence naming a variable
 *     that no longer switches anything is worse than no sentence;
 *   - the wizard's `EparagonyEnvironmentValues` is a third copy of the same
 *     vocabulary and was previously unguarded.
 *
 * Both sides are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the pure parsers against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND_TYPES = 'libs/integrations/eparagony/src/domain/types/eparagony-config.types.ts';
const BACKEND_ADAPTER =
  'libs/integrations/eparagony/src/infrastructure/adapters/eparagony-fiscalization.adapter.ts';
const BACKEND_MAPPER =
  'libs/integrations/eparagony/src/infrastructure/adapters/eparagony-document.mapper.ts';
const CORE_TAX_ENFORCEMENT =
  'libs/core/src/sales-documents/domain/types/tax-rate-enforcement.types.ts';
const FRONTEND = 'apps/web/src/plugins/eparagony/eparagony-config.types.ts';
const FRONTEND_COPY = 'apps/web/src/plugins/eparagony/components/eparagony-tax-fallback-copy.ts';
const FRONTEND_WIZARD = 'apps/web/src/features/connections/components/eparagony-setup.schema.ts';

/**
 * Blank line/block comments to equal-length whitespace, preserving every
 * newline, so a `]` inside a comment can never be mistaken for an array's
 * real closing bracket (#3002). Blanking rather than deleting keeps offsets
 * unchanged - not load-bearing here (this script reports no line numbers),
 * but it is the shape `check-sales-document-reason-mirror.mjs` was fixed to,
 * and diverging would leave two answers to the same problem in the tree.
 */
function blankComments(source) {
  return source
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Extract the string members of a `const <name> = [ ... ] as const;` array.
 *
 * Returns `null` when the declaration is absent OR parses to zero members
 * (#3002) - both are reported as a failure rather than an empty match, since
 * a renamed constant and a truncated parse must not read as "no drift", and
 * a comparison of two empty arrays passes vacuously without ever comparing
 * anything.
 */
export function parseStringArrayConst(source, name) {
  const blanked = blankComments(source);
  const match = blanked.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return null;
  const members = [...match[1].matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]);
  return members.length > 0 ? members : null;
}

/**
 * Extract a numeric `const <name> = 12_345;` value, tolerating the underscore
 * separators both sides use.
 *
 * Anchored on `const` and TERMINATED by `;`, following
 * `check-price-override-bound-mirror.mjs`. Unanchored and unterminated, this
 * read `= 90_000 - 5_000` as `90000` and passed a wrong mirror green (#3268
 * review); the self-check below pins that case.
 */
export function parseNumericConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*([0-9_]+)\\s*;`).exec(
    source,
  );
  if (!match) return null;
  const parsed = Number.parseInt(match[1].replace(/_/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extract a single-quoted `const <name> = 'value';` string value.
 *
 * Same anchoring rule as `parseNumericConst`, and the same `null`-means-failure
 * contract as `parseStringArrayConst`: a renamed constant must read as drift
 * rather than as "nothing to compare".
 */
export function parseStringConst(source, name) {
  const match = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*['"]([^'"]*)['"]\\s*;`,
  ).exec(source);
  return match ? match[1] : null;
}

/** Compare two strings, reporting a readable difference. */
export function diffStrings(label, backend, frontend) {
  if (backend === null) return `${label}: could not be parsed from the backend source`;
  if (frontend === null) return `${label}: could not be parsed from the frontend mirror`;
  if (backend === frontend) return null;
  return `${label} drifted. backend: ${backend}, frontend: ${frontend}`;
}

/** Compare two ordered lists, reporting the first difference in a readable form. */
export function diffLists(label, backend, frontend) {
  if (backend === null) return `${label}: could not be parsed from the backend source`;
  if (frontend === null) return `${label}: could not be parsed from the frontend mirror`;
  if (backend.length === frontend.length && backend.every((v, i) => v === frontend[i])) {
    return null;
  }
  return (
    `${label} drifted.\n` +
    `  backend : [${backend.join(', ')}]\n` +
    `  frontend: [${frontend.join(', ')}]`
  );
}

/** Compare two numbers, reporting a readable difference. */
export function diffNumbers(label, backend, frontend) {
  if (backend === null) return `${label}: could not be parsed from the backend source`;
  if (frontend === null) return `${label}: could not be parsed from the frontend mirror`;
  if (backend === frontend) return null;
  return `${label} drifted. backend: ${backend}, frontend: ${frontend}`;
}

async function run() {
  const [types, adapter, mapper, taxEnforcement, frontend, frontendCopy, frontendWizard] =
    await Promise.all(
      [
        BACKEND_TYPES,
        BACKEND_ADAPTER,
        BACKEND_MAPPER,
        CORE_TAX_ENFORCEMENT,
        FRONTEND,
        FRONTEND_COPY,
        FRONTEND_WIZARD,
      ].map((path) => readFile(join(ROOT, path), 'utf8')),
    );

  const failures = [
    diffLists(
      'Payment form vocabulary',
      parseStringArrayConst(types, 'EparagonyPaymentFormValues'),
      parseStringArrayConst(frontend, 'EPARAGONY_PAYMENT_FORM_VALUES')
    ),
    diffLists(
      'Tax rate slot vocabulary',
      parseStringArrayConst(types, 'EparagonyTaxRateCodeValues'),
      parseStringArrayConst(frontend, 'EPARAGONY_TAX_RATE_CODE_VALUES')
    ),
    diffNumbers(
      'Poll timeout minimum',
      parseNumericConst(adapter, 'MIN_STATUS_POLL_TIMEOUT_MS'),
      parseNumericConst(frontend, 'EPARAGONY_POLL_TIMEOUT_MIN_MS')
    ),
    diffNumbers(
      'Poll timeout maximum',
      parseNumericConst(adapter, 'MAX_STATUS_POLL_TIMEOUT_MS'),
      parseNumericConst(frontend, 'EPARAGONY_POLL_TIMEOUT_MAX_MS')
    ),
    diffNumbers(
      'Poll timeout default',
      parseNumericConst(adapter, 'DEFAULT_STATUS_POLL_TIMEOUT_MS'),
      parseNumericConst(frontend, 'EPARAGONY_POLL_TIMEOUT_DEFAULT_MS')
    ),
    diffStrings(
      'Default payment form',
      parseStringConst(mapper, 'DEFAULT_PAYMENT_FORM'),
      parseStringConst(frontend, 'EPARAGONY_DEFAULT_PAYMENT_FORM')
    ),
    diffStrings(
      'Tax-rate strict env var',
      parseStringConst(taxEnforcement, 'TAX_RATE_STRICT_ENV_VAR'),
      parseStringConst(frontendCopy, 'TAX_RATE_STRICT_ENV_VAR')
    ),
    diffLists(
      'Environment vocabulary',
      parseStringArrayConst(types, 'EparagonyEnvironmentValues'),
      parseStringArrayConst(frontendWizard, 'EparagonyEnvironmentValues')
    ),
  ].filter(Boolean);

  if (failures.length > 0) {
    console.error('eparagony.pl config mirror drifted:\n');
    for (const failure of failures) console.error(`  ${failure}\n`);
    console.error(`  backend : ${BACKEND_TYPES}`);
    console.error(`            ${BACKEND_ADAPTER}`);
    console.error(`            ${BACKEND_MAPPER}`);
    console.error(`            ${CORE_TAX_ENFORCEMENT}`);
    console.error(`  frontend: ${FRONTEND}`);
    console.error(`            ${FRONTEND_COPY}`);
    console.error(`            ${FRONTEND_WIZARD}`);
    process.exit(1);
  }
}

function selfCheck() {
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };

  const sample = `export const Vals = ['A', "B", 'C'] as const;`;
  expect(
    JSON.stringify(parseStringArrayConst(sample, 'Vals')) === JSON.stringify(['A', 'B', 'C']),
    'parseStringArrayConst should read both quote styles'
  );
  expect(
    parseStringArrayConst(sample, 'Missing') === null,
    'parseStringArrayConst should return null for an absent declaration'
  );

  const typed = `const Table: Record<string, string>[] = ['X'] as const;`;
  expect(
    JSON.stringify(parseStringArrayConst(typed, 'Table')) === JSON.stringify(['X']),
    'parseStringArrayConst should skip a type annotation'
  );

  const lineCommentBracket = `export const Vals = [
    // rejects one match, e.g. filter[]
    'A',
    'B',
  ] as const;`;
  expect(
    JSON.stringify(parseStringArrayConst(lineCommentBracket, 'Vals')) ===
      JSON.stringify(['A', 'B']),
    'parseStringArrayConst should not truncate on a `]` inside a line comment (#3002)'
  );

  const blockCommentBracket = `export const Vals = [
    /* legacy set was ['x'] */
    'A',
    'B',
  ] as const;`;
  expect(
    JSON.stringify(parseStringArrayConst(blockCommentBracket, 'Vals')) ===
      JSON.stringify(['A', 'B']),
    'parseStringArrayConst should not truncate on a `]` inside a block comment (#3002)'
  );

  expect(
    parseStringArrayConst('export const Vals = [] as const;', 'Vals') === null,
    'parseStringArrayConst should fail (return null) on a declaration parsing to zero values, rather than pass a vacuous empty comparison (#3002)'
  );

  expect(
    parseNumericConst('const N = 90_000;', 'N') === 90000,
    'parseNumericConst should strip underscore separators'
  );
  expect(
    parseNumericConst('export const N: number = 90_000;', 'N') === 90000,
    'parseNumericConst should skip an export keyword and a type annotation'
  );
  expect(
    parseNumericConst('const N = 5000;', 'Other') === null,
    'parseNumericConst should return null for an absent declaration'
  );
  expect(
    parseNumericConst('const N = 90_000 - 5_000;', 'N') === null,
    'parseNumericConst should refuse an expression rather than read its first operand'
  );
  expect(
    parseNumericConst('const OTHER_N = 1;', 'N') === null,
    'parseNumericConst should not match a constant whose name merely ends with the one asked for'
  );

  expect(
    parseStringConst("const S = 'Przelew';", 'S') === 'Przelew',
    'parseStringConst should read a single-quoted value'
  );
  expect(
    parseStringConst('export const S: Form = "Karta";', 'S') === 'Karta',
    'parseStringConst should skip an export keyword and a type annotation'
  );
  expect(
    parseStringConst("const S = 'x';", 'Missing') === null,
    'parseStringConst should return null for an absent declaration'
  );
  expect(
    parseStringConst("const S = prefix + 'x';", 'S') === null,
    'parseStringConst should refuse a concatenation rather than read one operand'
  );

  expect(diffLists('L', ['A'], ['A']) === null, 'diffLists should pass identical lists');
  expect(diffLists('L', ['A'], ['B']) !== null, 'diffLists should fail different members');
  expect(diffLists('L', ['A'], ['A', 'B']) !== null, 'diffLists should fail a longer mirror');
  expect(diffLists('L', ['A', 'B'], ['B', 'A']) !== null, 'diffLists should fail a reorder');
  expect(diffLists('L', null, ['A']) !== null, 'diffLists should fail an unparseable backend');
  expect(diffLists('L', ['A'], null) !== null, 'diffLists should fail an unparseable mirror');

  expect(diffNumbers('N', 1, 1) === null, 'diffNumbers should pass identical values');
  expect(diffNumbers('N', 1, 2) !== null, 'diffNumbers should fail different values');
  expect(diffNumbers('N', null, 1) !== null, 'diffNumbers should fail an unparseable backend');

  expect(diffStrings('S', 'a', 'a') === null, 'diffStrings should pass identical values');
  expect(diffStrings('S', 'a', 'b') !== null, 'diffStrings should fail different values');
  expect(diffStrings('S', null, 'a') !== null, 'diffStrings should fail an unparseable backend');
  expect(diffStrings('S', 'a', null) !== null, 'diffStrings should fail an unparseable mirror');

  if (problems.length > 0) {
    console.error('check-eparagony-config-mirror self-check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-eparagony-config-mirror self-check passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    run().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
}
