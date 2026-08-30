#!/usr/bin/env node
/**
 * check-connection-backlog-status-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * per-connection backlog status vocabulary (#2615).
 *
 * Rule. `ConnectionBacklogStatusValues` in
 *   libs/core/src/sync/domain/types/connection-sync-status.types.ts  (backend, authoritative)
 * and `CONNECTION_BACKLOG_STATUS_VALUES` in
 *   apps/web/src/features/connections/api/connections.types.ts       (frontend mirror)
 * MUST hold exactly the same string literals, in the same order.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so the
 * frontend has to keep a copy - and a copy drifts silently in both directions.
 * A status added only to core arrives as a value the panel has no label for; a
 * status added only to the frontend type-checks against something the API will
 * never send.
 *
 * SCOPE, so the wrong guard is not trusted: this compares two ARRAYS. It says
 * nothing about the panel's label and tone tables - those are
 * `Record<ConnectionBacklogStatus, ...>`, so a missing entry is a compile error
 * there rather than a finding here.
 *
 * Both files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the pure parser and differ against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE = 'libs/core/src/sync/domain/types/connection-sync-status.types.ts';
const CORE_NAME = 'ConnectionBacklogStatusValues';
const WEB_FILE = 'apps/web/src/features/connections/api/connections.types.ts';
const WEB_NAME = 'CONNECTION_BACKLOG_STATUS_VALUES';

/**
 * Extract the string literals of `export const <name> = [ ... ] as const;`.
 * Comments inside the array are stripped before the literals are read.
 */
export function parseStringArray(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) {
    return null;
  }
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) {
    return null;
  }
  const body = source
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

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
  const core = parseStringArray(
    "export const A = [\n  'a', // note\n  'b',\n] as const;",
    'A'
  );
  if (core === null || core.join(',') !== 'a,b') {
    throw new Error(`self-check: parser returned ${JSON.stringify(core)}`);
  }
  if (diff(['a', 'b'], ['a', 'b']) !== null) {
    throw new Error('self-check: identical arrays reported as drifted');
  }
  const d = diff(['a', 'b'], ['b']);
  if (d === null || d.missingInWeb.join(',') !== 'a') {
    throw new Error('self-check: drift not detected');
  }
  process.stdout.write('check-connection-backlog-status-mirror: self-check passed\n');
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

  const coreValues = parseStringArray(coreSource, CORE_NAME);
  const webValues = parseStringArray(webSource, WEB_NAME);

  if (coreValues === null || coreValues.length === 0) {
    process.stderr.write(`${CORE_FILE}: could not read ${CORE_NAME}\n`);
    process.exit(1);
  }
  if (webValues === null || webValues.length === 0) {
    process.stderr.write(`${WEB_FILE}: could not read ${WEB_NAME}\n`);
    process.exit(1);
  }

  const drift = diff(coreValues, webValues);
  if (drift !== null) {
    process.stderr.write('Backlog status mirror drifted.\n');
    process.stderr.write(`  ${CORE_FILE} -> ${coreValues.join(', ')}\n`);
    process.stderr.write(`  ${WEB_FILE} -> ${webValues.join(', ')}\n`);
    if (drift.missingInWeb.length > 0) {
      process.stderr.write(`  missing in the frontend: ${drift.missingInWeb.join(', ')}\n`);
    }
    if (drift.extraInWeb.length > 0) {
      process.stderr.write(`  not in core: ${drift.extraInWeb.join(', ')}\n`);
    }
    if (drift.orderDiffers) {
      process.stderr.write('  same values, different order\n');
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-connection-backlog-status-mirror: ok (${coreValues.length} statuses in sync)\n`
  );
}

await main();
