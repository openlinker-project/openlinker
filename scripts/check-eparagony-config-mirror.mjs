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
 *     "reported drifts from enforced" failure #2229 names.
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
const FRONTEND = 'apps/web/src/plugins/eparagony/eparagony-config.constants.ts';

/**
 * Extract the string members of a `const <name> = [ ... ] as const;` array.
 *
 * Returns `null` when the declaration is absent, which the caller reports as a
 * failure rather than an empty match - a renamed constant must not read as "no
 * drift".
 */
export function parseStringArrayConst(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return null;
  const members = [...match[1].matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]);
  return members;
}

/**
 * Extract a numeric `const <name> = 12_345;` value, tolerating the underscore
 * separators both sides use.
 */
export function parseNumericConst(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*([0-9_]+)`));
  if (!match) return null;
  const parsed = Number.parseInt(match[1].replace(/_/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
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
  const [types, adapter, frontend] = await Promise.all([
    readFile(join(ROOT, BACKEND_TYPES), 'utf8'),
    readFile(join(ROOT, BACKEND_ADAPTER), 'utf8'),
    readFile(join(ROOT, FRONTEND), 'utf8'),
  ]);

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
  ].filter(Boolean);

  if (failures.length > 0) {
    console.error('eparagony.pl config mirror drifted:\n');
    for (const failure of failures) console.error(`  ${failure}\n`);
    console.error(`  backend : ${BACKEND_TYPES}`);
    console.error(`            ${BACKEND_ADAPTER}`);
    console.error(`  frontend: ${FRONTEND}`);
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

  expect(
    parseNumericConst('const N = 90_000;', 'N') === 90000,
    'parseNumericConst should strip underscore separators'
  );
  expect(
    parseNumericConst('const N = 5000;', 'Other') === null,
    'parseNumericConst should return null for an absent declaration'
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
