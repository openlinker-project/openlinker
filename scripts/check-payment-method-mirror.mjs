#!/usr/bin/env node
/**
 * check-payment-method-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the neutral
 * order payment-method vocabulary (#3294).
 *
 * The authoritative declaration is `PaymentMethodValues` in
 *   libs/core/src/orders/domain/types/payment-method.types.ts
 * `apps/web/src/features/orders/api/order-snapshot.schema.ts` re-declares the
 * same exported name because the browser bundle does not depend on
 * `@openlinker/core` (#591). A copy drifts silently: a value added only to core
 * is rejected by the web parser as "unrecognised" and degrades to absent, and
 * nothing fails.
 *
 * One rule - value + order equality. Both files are parsed TEXTUALLY (no
 * TypeScript import) so this stays a zero-dependency `check:invariants` step.
 * Run with `--self-check` to exercise the pure parser + differ on synthetic
 * inputs, including a deliberately drifted fixture.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE = join('libs', 'core', 'src', 'orders', 'domain', 'types', 'payment-method.types.ts');
const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'order-snapshot.schema.ts');
const DECLARATION = 'PaymentMethodValues';

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Values of `export const <name> = [...] as const`, in declaration order, or null. */
export function parseValues(source, name = DECLARATION) {
  const match = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(
    stripComments(source),
  );
  if (match === null) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function diff(core, frontend) {
  if (core === null) return [`core declares no ${DECLARATION}`];
  if (frontend === null) return [`frontend declares no ${DECLARATION}`];
  if (core.length === frontend.length && core.every((v, i) => v === frontend[i])) return [];
  return [`${DECLARATION} drifted: core [${core.join(', ')}] vs frontend [${frontend.join(', ')}]`];
}

function selfCheck() {
  const src = (vals) => `export const ${DECLARATION} = [${vals.map((v) => `'${v}'`).join(', ')}] as const;`;
  const cases = [
    ['identical', src(['a', 'b']), src(['a', 'b']), 0],
    ['value added in core only', src(['a', 'b', 'c']), src(['a', 'b']), 1],
    ['reordered in frontend', src(['a', 'b']), src(['b', 'a']), 1],
    ['commented value ignored', `export const ${DECLARATION} = [\n 'a', // 'x'\n 'b',\n] as const;`, src(['a', 'b']), 0],
    ['frontend declaration missing', src(['a']), 'export const Other = [] as const;', 1],
  ];
  let failed = 0;
  for (const [label, core, fe, expected] of cases) {
    const got = diff(parseValues(core), parseValues(fe)).length;
    if (got !== expected) {
      console.error(`self-check FAILED: ${label} (expected ${expected} violation(s), got ${got})`);
      failed++;
    }
  }
  if (failed > 0) process.exit(1);
  console.log('check-payment-method-mirror self-check: ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const [core, frontend] = await Promise.all(
    [CORE_FILE, FRONTEND_FILE].map((f) => readFile(join(repoRoot, f), 'utf8')),
  );
  const violations = diff(parseValues(core), parseValues(frontend));
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-payment-method-mirror: ${v}`);
    console.error(`Fix: make ${FRONTEND_FILE} match ${CORE_FILE}.`);
    process.exit(1);
  }
  console.log('check-payment-method-mirror: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
