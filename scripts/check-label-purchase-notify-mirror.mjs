#!/usr/bin/env node
/**
 * check-label-purchase-notify-mirror.mjs
 *
 * Lint-time invariant for the browser's copy of the label-purchase notification
 * config keys (#4097).
 *
 * Rule. The dispatch service reads `config.<SHIPPING_CONFIG_KEY>.<NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY>`
 * (core). The connection edit page writes the same path, and the browser cannot
 * import core (#591), so both names exist twice:
 *
 *   libs/core/src/shipping/domain/types/dispatch-notification.types.ts
 *   apps/web/src/features/connections/lib/label-purchase-notification.ts
 *
 * If either copy is renamed alone, the toggle writes a key nothing reads: it
 * saves, shows as on, and no label purchase ever notifies the shop.
 *
 * Files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step. Run with `--self-check` to exercise the reader.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE = 'libs/core/src/shipping/domain/types/dispatch-notification.types.ts';
const WEB = 'apps/web/src/features/connections/lib/label-purchase-notification.ts';
const NAMES = ['SHIPPING_CONFIG_KEY', 'NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY'];

/** `const <name> = '<value>';`, ignoring any `export` prefix and quote style. */
export function readStringConst(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(['"])([^'"]*)\\1\\s*;`).exec(source);
  return match ? match[2] : null;
}

function selfCheck() {
  const checks = [
    [readStringConst("export const A = 'shipping';", 'A'), 'shipping'],
    [readStringConst('const A  =  "x" ;', 'A'), 'x'],
    [readStringConst("const AB = 'x';", 'A'), null],
    [readStringConst('const A = OTHER;', 'A'), null],
  ];
  checks.forEach(([actual, expected], i) => {
    if (actual !== expected) {
      console.error(`check-label-purchase-notify-mirror --self-check FAILED: case ${i} returned ${actual}, expected ${expected}`);
      process.exit(1);
    }
  });
  console.log('check-label-purchase-notify-mirror --self-check: reader behaves');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const core = await readFile(join(repoRoot, CORE), 'utf8');
const web = await readFile(join(repoRoot, WEB), 'utf8');
const failures = [];
for (const name of NAMES) {
  const coreValue = readStringConst(core, name);
  const webValue = readStringConst(web, name);
  if (coreValue === null) failures.push(`${CORE}: ${name} not found as a string literal`);
  if (webValue === null) failures.push(`${WEB}: ${name} not found as a string literal`);
  if (coreValue !== null && webValue !== null && coreValue !== webValue) {
    failures.push(`${name}: core has '${coreValue}', web has '${webValue}'. The toggle would write a key core never reads.`);
  }
}

if (failures.length > 0) {
  console.error('check-label-purchase-notify-mirror FAILED:\n');
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log('check-label-purchase-notify-mirror: web config keys match core');
