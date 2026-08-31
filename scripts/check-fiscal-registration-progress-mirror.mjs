#!/usr/bin/env node
/**
 * check-fiscal-registration-progress-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * registration progress vocabulary (#2526).
 *
 * Rule. `FiscalRegistrationProgressValues` in
 *   libs/core/src/fiscalization/domain/types/fiscal-registration-progress.types.ts  (backend, authoritative)
 * and the `FiscalRegistrationProgress` union in
 *   apps/web/src/features/fiscalization/api/fiscalization.types.ts                   (frontend mirror)
 * MUST hold exactly the same string literals, in the same order.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so the
 * frontend keeps a copy, and a copy drifts silently in both directions. The cost
 * of drift here is specific: a value the frontend cannot name falls into a
 * fallback arm, so the panel states the wrong thing about a fiscal document
 * rather than failing loudly. `stalled` reaching the frontend as an unnamed
 * value would read as an ordinary wait, which is exactly the misreading the
 * value was added to prevent.
 *
 * The parsers are the sibling reconcile-outcome script's shape, restated here
 * rather than imported: these scripts run their check on import, so importing
 * one from the other would run the sibling's whole check as a side effect and
 * report ITS drift under THIS script's name. Each stays self-contained and
 * zero-dependency, like every other sibling.
 *
 * SCOPE: this compares two VALUE LISTS. It says nothing about whether a surface
 * has a branch for each value; the panel tests cover that.
 *
 * Run with `--self-check` to exercise the shared parsers against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Strip line and block comments so an annotated entry is never read as a value. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Extract the string literals of `export const <name> = [ ... ] as const;`. */
function parseConstArray(source, name) {
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
 * Extract the string literals of `export type <name> = 'a' | 'b';`.
 *
 * Comments are stripped BEFORE the terminator is located: a comment carrying a
 * `;` would otherwise end the slice early and report unreadable drift about a
 * union that is fine.
 */
function parseTypeUnion(source, name) {
  const declRe = new RegExp(`type\\s+${name}\\s*=`);
  const decl = declRe.exec(source);
  if (!decl) {
    return null;
  }
  const rest = stripComments(source.slice(decl.index + decl[0].length));
  const end = rest.indexOf(';');
  if (end === -1) {
    return null;
  }
  return [...rest.slice(0, end).matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

/** Pure differ. `null` means the two lists are identical, order included. */
function diff(coreValues, webValues) {
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

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE =
  'libs/core/src/fiscalization/domain/types/fiscal-registration-progress.types.ts';
const CORE_NAME = 'FiscalRegistrationProgressValues';
const WEB_FILE = 'apps/web/src/features/fiscalization/api/fiscalization.types.ts';
const WEB_NAME = 'FiscalRegistrationProgress';

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      failures.push(`  ${label}: expected ${wanted}, got ${actual}`);
    }
  };

  expect(
    'parses the core array shape',
    parseConstArray("export const A = [\n  'queued',\n  'running',\n] as const;", 'A')?.join(','),
    'queued,running',
  );
  expect(
    'parses the frontend union shape',
    parseTypeUnion("export type U =\n  | 'queued'\n  | 'running';", 'U')?.join(','),
    'queued,running',
  );
  expect('identical lists are not drift', diff(['a', 'b'], ['a', 'b']), null);
  expect(
    'a value the frontend cannot name is drift',
    diff(['a', 'b'], ['a'])?.missingInWeb.join(','),
    'b',
  );

  if (failures.length > 0) {
    process.stderr.write('check-fiscal-registration-progress-mirror: self-check failed\n');
    for (const f of failures) {
      process.stderr.write(`${f}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('check-fiscal-registration-progress-mirror: self-check passed\n');
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
    process.stderr.write('Fiscal registration progress mirror drifted.\n');
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
    `check-fiscal-registration-progress-mirror: ok (${coreValues.length} values in sync)\n`,
  );
}

await main();
