#!/usr/bin/env node
/**
 * check-system-connection-id-mirror.mjs
 *
 * Lint-time invariant for the all-zero `SYSTEM_CONNECTION_ID` placeholder
 * (#2745). It is independently hardcoded in three places with no shared
 * source:
 *
 *   libs/core/src/inventory/application/services/inventory.service.ts
 *   apps/worker/src/events/master-deletion-to-job.handler.ts
 *   apps/web/src/features/connections/api/connections.types.ts   (frontend mirror)
 *
 * The two backend copies exist because they're private/module-scoped
 * fallback constants in different packages; the frontend copy exists because
 * the browser bundle does not depend on `@openlinker/core` (#591). If any of
 * the three ever changes, the others silently stop matching — the frontend
 * special-case in `ConnectionEntityLabel` would stop firing and the row would
 * revert to "Unknown" with zero build-time signal.
 *
 * Both files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the pure parser and differ against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SOURCES = [
  {
    file: 'libs/core/src/inventory/application/services/inventory.service.ts',
    name: 'SYSTEM_CONNECTION_ID',
  },
  {
    file: 'apps/worker/src/events/master-deletion-to-job.handler.ts',
    name: 'SYSTEM_CONNECTION_ID',
  },
  {
    file: 'apps/web/src/features/connections/api/connections.types.ts',
    name: 'SYSTEM_CONNECTION_ID',
  },
];

/**
 * Extract the string literal of a `const <name> = '...'` / `= "..."`
 * declaration, regardless of preceding modifiers (`private readonly`,
 * `export`, etc.).
 */
export function parseStringConst(source, name) {
  const match = source.match(
    new RegExp(`\\b${name}\\s*(?::\\s*[^=]+)?=\\s*['"]([^'"]*)['"]`)
  );
  return match ? match[1] : null;
}

export function diff(values) {
  const distinct = [...new Set(values.map((v) => v.value))];
  if (distinct.length <= 1) {
    return null;
  }
  return values;
}

function selfCheck() {
  const parsed = parseStringConst(
    "  private readonly SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';",
    'SYSTEM_CONNECTION_ID'
  );
  if (parsed !== '00000000-0000-0000-0000-000000000000') {
    throw new Error(`self-check: parser returned ${JSON.stringify(parsed)}`);
  }
  const same = diff([
    { file: 'a', value: 'x' },
    { file: 'b', value: 'x' },
  ]);
  if (same !== null) {
    throw new Error('self-check: identical values reported as drifted');
  }
  const drifted = diff([
    { file: 'a', value: 'x' },
    { file: 'b', value: 'y' },
  ]);
  if (drifted === null) {
    throw new Error('self-check: drift not detected');
  }
  process.stdout.write('check-system-connection-id-mirror: self-check passed\n');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const values = [];
  for (const { file, name } of SOURCES) {
    const source = await readFile(join(ROOT, file), 'utf8');
    const value = parseStringConst(source, name);
    if (value === null) {
      process.stderr.write(`${file}: could not read ${name}\n`);
      process.exit(1);
    }
    values.push({ file, value });
  }

  const drift = diff(values);
  if (drift !== null) {
    process.stderr.write('SYSTEM_CONNECTION_ID mirror drifted.\n');
    for (const { file, value } of drift) {
      process.stderr.write(`  ${file} -> ${value}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-system-connection-id-mirror: ok (${values.length} copies in sync)\n`
  );
}

// Only run main() when invoked as a script, so importing `parseStringConst` /
// `diff` from a test cannot trigger the whole check (and its `process.exit`)
// as an import side effect. `pathToFileURL` handles spaces / escaping /
// Windows paths that a naive `file://${process.argv[1]}` template breaks on
// (same shape as scripts/create-adapter.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
