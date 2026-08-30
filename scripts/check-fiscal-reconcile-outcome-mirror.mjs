#!/usr/bin/env node
/**
 * check-fiscal-reconcile-outcome-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the reconcile
 * outcome vocabulary (#2522, ADR-042 amendment #2502 decision 3).
 *
 * Rule. `FiscalReconcileOutcomeValues` in
 *   libs/core/src/fiscalization/domain/types/fiscalization.types.ts  (backend, authoritative)
 * and the `FiscalReconcileOutcome` union in
 *   apps/web/src/features/fiscalization/api/fiscalization.types.ts   (frontend mirror)
 * MUST hold exactly the same string literals, in the same order.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so the
 * frontend keeps a copy - and a copy drifts silently in both directions. This
 * one already did: `still-unknown` was added to core by #2522 and not to the
 * frontend, so the value fell into the panel's `else` arm and told the operator
 * the provider could not be queried, on a check that had in fact worked and
 * simply had not settled. A backend value the frontend cannot name does not
 * fail loudly; it renders the wrong sentence.
 *
 * SHAPE NOTE, and why this script is not a copy of its siblings: the two sides
 * are written differently. Core declares an `as const` ARRAY (it needs the
 * runtime values for Swagger and for its own specs); the frontend declares a
 * TYPE UNION, because it has no runtime use for the list. Two parsers, one
 * comparison - the alternative was making the frontend carry an array nothing
 * reads, which is worse than parsing two shapes here.
 *
 * SCOPE, so the wrong guard is not trusted: this compares two VALUE LISTS. It
 * says nothing about whether the panel has a branch for each outcome. The
 * panel's `handleReconcile` is an if/else chain with a terminal `else`, so a
 * value added to both sides with no branch still renders the `unsupported`
 * copy and passes here. That gap is covered by the outcome tests in
 * `apps/web/src/features/orders/components/sales-document-panel.test.tsx`,
 * which assert the copy each outcome produces.
 *
 * Both files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the pure parsers and differ against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE = 'libs/core/src/fiscalization/domain/types/fiscalization.types.ts';
const CORE_NAME = 'FiscalReconcileOutcomeValues';
const WEB_FILE = 'apps/web/src/features/fiscalization/api/fiscalization.types.ts';
const WEB_NAME = 'FiscalReconcileOutcome';

/** Strip line and block comments so an annotated entry is never read as a value. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Extract the string literals of `export const <name> = [ ... ] as const;`.
 *
 * Anchored on `const <name>` and then on the FIRST bracket after it, so a
 * docblock above the declaration cannot supply the opening bracket.
 */
export function parseConstArray(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) {
    return null;
  }
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) {
    return null;
  }
  const body = stripComments(source.slice(open + 1, close));
  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

/**
 * Extract the string literals of `export type <name> = 'a' | 'b';`, single or
 * multi line, with or without a leading `|`.
 *
 * Terminated on the first `;` after the `=`, which is what keeps the parser
 * from running on into the next declaration when the union is malformed - it
 * returns a short list that fails the diff rather than a long one that
 * accidentally passes.
 */
export function parseTypeUnion(source, name) {
  const declRe = new RegExp(`type\\s+${name}\\s*=`);
  const decl = declRe.exec(source);
  if (!decl) {
    return null;
  }
  const from = decl.index + decl[0].length;
  const end = source.indexOf(';', from);
  if (end === -1) {
    return null;
  }
  const body = stripComments(source.slice(from, end));
  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

/** Pure differ. `null` means the two lists are identical, order included. */
export function diff(coreValues, webValues) {
  if (coreValues.length === webValues.length && coreValues.every((v, i) => v === webValues[i])) {
    return null;
  }
  return {
    missingInWeb: coreValues.filter((v) => !webValues.includes(v)),
    extraInWeb: webValues.filter((v) => !coreValues.includes(v)),
    orderDiffers:
      coreValues.length === webValues.length && coreValues.some((v, i) => v !== webValues[i]),
  };
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      failures.push(`  ${label}: expected ${wanted}, got ${actual}`);
    }
  };

  expect(
    'parses a const array',
    parseConstArray("export const A = [\n  'a', // note\n  'b',\n] as const;", 'A')?.join(','),
    'a,b',
  );
  expect(
    'strips block comments in an array',
    parseConstArray("export const A = [\n  /* 'ghost' */\n  'a',\n] as const;", 'A')?.join(','),
    'a',
  );
  expect('absent const declaration', parseConstArray('export const B = [];', 'A'), null);

  expect(
    'parses a single-line union',
    parseTypeUnion("export type U = 'a' | 'b';", 'U')?.join(','),
    'a,b',
  );
  expect(
    'parses a multi-line union with a leading pipe',
    parseTypeUnion("export type U =\n  | 'a'\n  | 'b'\n  | 'c';", 'U')?.join(','),
    'a,b,c',
  );
  expect(
    'strips comments in a union',
    parseTypeUnion("export type U =\n  // 'ghost'\n  | 'a';", 'U')?.join(','),
    'a',
  );
  // A union must not swallow the declaration after it, or a malformed mirror
  // could pick up unrelated literals and pass.
  expect(
    'stops at the terminating semicolon',
    parseTypeUnion("export type U = 'a';\nexport type V = 'b';", 'U')?.join(','),
    'a',
  );
  expect('absent type declaration', parseTypeUnion('export type V = string;', 'U'), null);

  expect('identical lists are not drift', diff(['a', 'b'], ['a', 'b']), null);
  expect(
    'a value missing from the frontend is drift',
    diff(['a', 'b'], ['a'])?.missingInWeb.join(','),
    'b',
  );
  expect(
    'a value the backend never sends is drift',
    diff(['a'], ['a', 'b'])?.extraInWeb.join(','),
    'b',
  );
  expect('a reordered list is drift', diff(['a', 'b'], ['b', 'a'])?.orderDiffers, true);

  if (failures.length > 0) {
    process.stderr.write('check-fiscal-reconcile-outcome-mirror: self-check failed\n');
    for (const f of failures) {
      process.stderr.write(`${f}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('check-fiscal-reconcile-outcome-mirror: self-check passed\n');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const [coreSource, webSource] = await Promise.all([
    readFile(join(ROOT, CORE_FILE), 'utf8'),
    readFile(join(ROOT, WEB_FILE), 'utf8'),
  ]);

  const coreValues = parseConstArray(coreSource, CORE_NAME);
  const webValues = parseTypeUnion(webSource, WEB_NAME);

  if (coreValues === null || coreValues.length === 0) {
    process.stderr.write(`${CORE_FILE}: could not read ${CORE_NAME}\n`);
    process.exit(1);
  }
  if (webValues === null || webValues.length === 0) {
    process.stderr.write(`${WEB_FILE}: could not read the ${WEB_NAME} union\n`);
    process.exit(1);
  }

  const drift = diff(coreValues, webValues);
  if (drift !== null) {
    process.stderr.write('Fiscal reconcile outcome mirror drifted.\n');
    process.stderr.write(`  ${CORE_FILE} -> ${coreValues.join(', ')}\n`);
    process.stderr.write(`  ${WEB_FILE} -> ${webValues.join(', ')}\n`);
    if (drift.missingInWeb.length > 0) {
      process.stderr.write(
        `  missing in the frontend: ${drift.missingInWeb.join(', ')} ` +
          '(the API can send it and no surface can name it)\n',
      );
    }
    if (drift.extraInWeb.length > 0) {
      process.stderr.write(
        `  not in core: ${drift.extraInWeb.join(', ')} (the API will never send it)\n`,
      );
    }
    if (drift.orderDiffers) {
      process.stderr.write('  same values, different order\n');
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-fiscal-reconcile-outcome-mirror: ok (${coreValues.length} outcomes in sync)\n`,
  );
}

await main();
