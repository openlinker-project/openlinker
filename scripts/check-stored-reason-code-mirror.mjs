#!/usr/bin/env node
/**
 * check-stored-reason-code-mirror.mjs
 *
 * Lint-time invariant for the frontend mirrors of the stored-reason codes
 * (#3866): codes the backend stores or returns in place of an English
 * sentence, which the frontend renders in the operator's language.
 *
 * For every entry in MIRRORS:
 *
 * Rule A - MIRROR. The `as const` array in core and its copy in apps/web hold
 *   the same literals in the same order. The browser bundle cannot import core
 *   (#591), so the copy drifts silently in both directions otherwise: a code
 *   added only to core renders as raw text, one added only to the frontend
 *   type-checks against a value the API never sends.
 * Rule B - COPY COVERAGE. The English locale object at `copyPath` has exactly
 *   one key per code. Polish coverage is `check-locales`' job (same key set in
 *   both languages).
 *
 * Self-contained on purpose, like every sibling mirror guard: importing a
 * sibling's parser would run that sibling's `main()` as a side effect.
 *
 * Run with `--self-check` to exercise the differ against synthetic inputs.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const MIRRORS = [
  {
    name: 'WebhookDlqCodeValues',
    backend: 'libs/core/src/webhooks/domain/types/webhook-dlq-code.types.ts',
    frontend: 'apps/web/src/features/webhook-deliveries/api/webhook-deliveries.types.ts',
    copyFile: 'apps/web/src/locales/en/webhook-deliveries.json',
    copyPath: ['dlqCodes'],
  },
  {
    name: 'RoutedConnectionStateValues',
    backend: 'libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts',
    frontend: 'apps/web/src/features/orders/api/orders.types.ts',
    copyFile: 'apps/web/src/locales/en/orders.json',
    copyPath: ['salesDocumentBlockDetail', 'connectionState'],
  },
];

/** String literals of `export const <name> = [...]`, comments blanked first. */
export function parseValues(content, name) {
  const decl = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`).exec(content);
  if (!decl) return null;
  const blank = (match) => ' '.repeat(match.length);
  const scrubbed = content.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
  const open = decl.index + decl[0].length - 1;
  const close = scrubbed.indexOf(']', open);
  if (close === -1) return null;
  const values = [];
  const literal = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literal.exec(scrubbed.slice(open + 1, close))) !== null) values.push(m[1] ?? m[2]);
  return values;
}

/** Keys of the object at `path` in a JSON document, or `null`. */
export function readCopyKeys(src, path) {
  let node = JSON.parse(src);
  for (const segment of path) {
    if (node === null || typeof node !== 'object' || !(segment in node)) return null;
    node = node[segment];
  }
  return node !== null && typeof node === 'object' && !Array.isArray(node) ? Object.keys(node) : null;
}

export function diffValues(backend, frontend) {
  const issues = [];
  for (const v of backend) if (!frontend.includes(v)) issues.push(`'${v}' is in core but missing from the frontend mirror`);
  for (const v of frontend) if (!backend.includes(v)) issues.push(`'${v}' is in the frontend mirror but missing from core`);
  if (issues.length === 0 && backend.join('\u0000') !== frontend.join('\u0000')) {
    issues.push(`same members, different order: core [${backend.join(', ')}] vs frontend [${frontend.join(', ')}]`);
  }
  return issues;
}

export function diffCopy(values, keys, where) {
  const issues = [];
  for (const v of values) if (!keys.includes(v)) issues.push(`'${v}' has no entry in ${where}`);
  for (const k of keys) if (!values.includes(k)) issues.push(`${where} carries '${k}', which is not a code`);
  return issues;
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`${label}: expected ${wanted}, got ${actual}`);
  };
  expect('identical arrays', diffValues(['a', 'b'], ['a', 'b']).length, 0);
  expect('missing in frontend', diffValues(['a', 'b'], ['a']).length, 1);
  expect('extra in frontend', diffValues(['a'], ['a', 'b']).length, 1);
  expect('reordered', diffValues(['a', 'b'], ['b', 'a']).length, 1);
  expect('full copy', diffCopy(['a'], ['a'], 'x').length, 0);
  expect('missing copy', diffCopy(['a', 'b'], ['a'], 'x').length, 1);
  expect('orphan copy', diffCopy(['a'], ['a', 'b'], 'x').length, 1);
  expect(
    'parser skips a ] in a comment',
    parseValues(`export const X = [\n  /** [] */\n  'one',\n  'two',\n] as const;`, 'X')?.join(','),
    'one,two',
  );
  expect('json reader', readCopyKeys('{"a":{"b":{"one":"x"}}}', ['a', 'b'])?.join(','), 'one');
  expect('json reader missing path', readCopyKeys('{"a":{}}', ['a', 'c']), null);
  if (failures.length > 0) {
    console.error('✗ check-stored-reason-code-mirror self-check FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ check-stored-reason-code-mirror self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }
  const failures = [];
  for (const mirror of MIRRORS) {
    const [backendSrc, frontendSrc, copySrc] = await Promise.all(
      [mirror.backend, mirror.frontend, mirror.copyFile].map((f) => readFile(join(repoRoot, f), 'utf8')),
    );
    const backend = parseValues(backendSrc, mirror.name);
    const frontend = parseValues(frontendSrc, mirror.name);
    const copy = readCopyKeys(copySrc, mirror.copyPath);
    if (!backend || backend.length === 0) failures.push(`${mirror.backend}: could not read ${mirror.name}`);
    if (!frontend || frontend.length === 0) failures.push(`${mirror.frontend}: could not read ${mirror.name}`);
    if (!copy) failures.push(`${mirror.copyFile}: no object at ${mirror.copyPath.join('.')}`);
    if (!backend || !frontend || !copy || backend.length === 0 || frontend.length === 0) continue;
    for (const issue of diffValues(backend, frontend)) failures.push(`${mirror.name}: ${issue}`);
    for (const issue of diffCopy(backend, copy, `${mirror.copyFile} ${mirror.copyPath.join('.')}`)) {
      failures.push(`${mirror.name}: ${issue}`);
    }
  }
  if (failures.length > 0) {
    console.error('✗ check-stored-reason-code-mirror FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-stored-reason-code-mirror: ${MIRRORS.length} mirror(s) in sync`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
