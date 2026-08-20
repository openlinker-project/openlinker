#!/usr/bin/env node
/**
 * check-stream-writes
 *
 * Every Redis stream write must go through `xAddBounded`
 * (`libs/shared/src/redis/stream-retention.ts`), which types its `streamName`
 * as the `RedisStreamName` union — so writing to a stream with no declared
 * retention is a compile error at the call site.
 *
 * That type check is only as good as the rule that nothing calls `.xAdd(`
 * directly. Without this script, a sixth write site with a fresh string literal
 * would compile cleanly and silently inherit the conservative default, which is
 * materially wrong for a dead-letter or job stream (#2163). The map alone cannot
 * prevent it: `resolveStreamBound` must accept a plain `string`, because
 * `EventPublisherPort.publish` takes a dynamic stream name.
 *
 * Run from `pnpm lint` via `pnpm check:invariants`.
 *
 * Usage:
 *   node scripts/check-stream-writes.mjs
 *   node scripts/check-stream-writes.mjs --self-check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['libs', 'apps'];
const REPO_ROOT = process.cwd();

/**
 * Files permitted to call `.xAdd(` directly, with the reason.
 *
 * Keep this list tiny. A new entry means a stream write that the retention
 * seam does not cover, which is the exact regression this script exists to
 * prevent — so adding one should be a deliberate, reviewed decision.
 */
const ALLOW_LIST = new Map([
  [
    'libs/shared/src/redis/stream-retention.ts',
    'defines xAddBounded — the seam itself must call xAdd',
  ],
]);

/** Test files write to streams to set up fixtures; retention is not their concern. */
const TEST_PATTERN = /\.(spec|int-spec|e2e-spec)\.ts$|[\\/]__tests__[\\/]|[\\/]test[\\/]/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Find direct `.xAdd(` calls in a source string.
 *
 * Deliberately naive: a line-based scan that skips comment lines. It can only
 * be wrong in the safe direction for the cases that matter — a real call is
 * never missed, and a false positive is visible and easy to allow-list.
 */
export function findDirectXAddCalls(source) {
  const hits = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    if (!/\.xAdd\s*\(/.test(line)) continue;
    hits.push({ line: i + 1, text: trimmed });
  }
  return hits;
}

function selfCheck() {
  const cases = [
    { name: 'plain call', source: 'await client.xAdd("s", "*", f);', expected: 1 },
    { name: 'spaced call', source: 'await client.xAdd ("s", "*", f);', expected: 1 },
    { name: 'line comment', source: '// await client.xAdd("s", "*", f);', expected: 0 },
    { name: 'jsdoc line', source: ' * `client.xAdd(...)` is banned here', expected: 0 },
    { name: 'wrapper call', source: 'await xAddBounded(client, name, fields);', expected: 0 },
    { name: 'unrelated', source: 'const x = 1;', expected: 0 },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const actual = findDirectXAddCalls(testCase.source).length;
    if (actual !== testCase.expected) {
      console.error(
        `  ✗ ${testCase.name}: expected ${testCase.expected} hit(s), got ${actual}`
      );
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`✗ check-stream-writes --self-check: ${failures} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-stream-writes --self-check: ${cases.length} case(s) passed.`);
}

function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const violations = [];
  let scanned = 0;

  for (const root of ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file).split('\\').join('/');
      if (TEST_PATTERN.test(rel)) continue;
      scanned += 1;
      if (ALLOW_LIST.has(rel)) continue;

      for (const hit of findDirectXAddCalls(readFileSync(file, 'utf8'))) {
        violations.push({ file: rel, ...hit });
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-stream-writes: direct .xAdd( call(s) bypass the retention seam.\n');
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ${violation.text}`);
    }
    console.error(
      '\n  Every stream write must go through `xAddBounded` from `@openlinker/shared/redis`,'
    );
    console.error(
      '  so an unbounded stream cannot exist. Add the stream to `REDIS_STREAM_NAMES` and'
    );
    console.error('  give it a retention bound in `STREAM_BOUNDS` (#2163).');
    process.exit(1);
  }

  console.log(`✓ check-stream-writes: ${scanned} source file(s) checked. All writes are bounded.`);
}

main();
