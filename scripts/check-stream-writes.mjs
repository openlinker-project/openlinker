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
 * Two rules:
 *   - `bare-xadd`     — no direct `.xAdd(` outside the seam.
 *   - `dynamic-seam`  — `xAddBoundedDynamic` (which skips the union type by
 *                       design) is referenced only by its one legitimate caller.
 *
 * Run from `pnpm lint` via `pnpm check:invariants`.
 *
 * Usage:
 *   node scripts/check-stream-writes.mjs
 *   node scripts/check-stream-writes.mjs --self-check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['libs', 'apps'];
/**
 * Anchored to this file, never to `process.cwd()` (#2792). Under the CWD the
 * walk found nothing, `scanned` stayed 0, and the run printed
 * "0 source file(s) checked. All writes are bounded." and exited 0 — the only
 * guard against an unbounded Redis stream reporting success for having looked
 * at nothing. A pre-commit hook, an editor task or a CI step that does not
 * happen to start at the repo root was enough to disarm it.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A run that scanned nothing is a broken run, not a clean one. Belt to the
 * anchoring above: it also fails a future `ROOTS` typo or an over-eager
 * `TEST_PATTERN`, neither of which the anchor can catch.
 */
const MIN_SCANNED_FILES = 100;

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

/**
 * Files permitted to reference `xAddBoundedDynamic`.
 *
 * Exactly one production caller: the event publisher, whose
 * `EventPublisherPort.publish(streamName: string, …)` contract is dynamic by
 * design. Nothing else enforced "one caller", so a future import would get an
 * un-typed write with no compile error and no lint error. This is what makes
 * the escape hatch's narrowness real rather than merely stated.
 */
const DYNAMIC_SEAM_ALLOW_LIST = new Set([
  'libs/shared/src/redis/stream-retention.ts',
  'libs/shared/src/redis/index.ts',
  'libs/core/src/events/infrastructure/adapters/redis-streams-event-publisher.ts',
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
 * Blank out comment lines, preserving line numbering so hits stay reportable.
 *
 * Line-oriented rather than a real parser: it only has to stop a doc comment
 * that mentions `.xAdd(` from reading as a call.
 */
function stripComments(source) {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('*') || trimmed.startsWith('//') ? '' : line;
    })
    .join('\n');
}

/** Report every regex match as `{ line, text }` against the original source. */
function collectMatches(source, pattern) {
  const hits = [];
  const stripped = stripComments(source);
  const lines = source.split('\n');

  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    const line = stripped.slice(0, match.index).split('\n').length;
    hits.push({ line, text: lines[line - 1]?.trim() ?? '' });
  }
  return hits;
}

/**
 * Find direct stream-write calls in a source string.
 *
 * Matches across line boundaries, because prettier routinely breaks a long
 * client expression as `client\n  .xAdd(` at 100 columns — a purely line-based
 * scan would miss exactly the calls most likely to appear in real code. Also
 * catches the bracket form `client['xAdd'](…)`.
 *
 * It does NOT catch an aliased call (`const add = client.xAdd`) or a raw
 * `sendCommand(['XADD', …])`. That is an accepted limit rather than an
 * oversight: this script is defence-in-depth, and the real guard is the
 * `RedisStreamName` union on `xAddBounded`'s parameter, enforced by the compiler.
 */
export function findDirectXAddCalls(source) {
  return collectMatches(source, /(?:\.\s*xAdd|\[\s*['"`]xAdd['"`]\s*\])\s*\(/g);
}

/** Find references to the dynamic escape hatch. */
export function findDynamicSeamRefs(source) {
  return collectMatches(source, /xAddBoundedDynamic/g);
}

function selfCheck() {
  const cases = [
    {
      name: 'plain call',
      fn: findDirectXAddCalls,
      source: 'await client.xAdd("s", "*", f);',
      expected: 1,
    },
    {
      name: 'spaced call',
      fn: findDirectXAddCalls,
      source: 'await client.xAdd ("s", "*", f);',
      expected: 1,
    },
    {
      name: 'line comment',
      fn: findDirectXAddCalls,
      source: '// await client.xAdd("s", "*", f);',
      expected: 0,
    },
    {
      name: 'jsdoc line',
      fn: findDirectXAddCalls,
      source: ' * `client.xAdd(...)` is banned here',
      expected: 0,
    },
    {
      name: 'wrapper call',
      fn: findDirectXAddCalls,
      source: 'await xAddBounded(client, name, fields);',
      expected: 0,
    },
    { name: 'unrelated', fn: findDirectXAddCalls, source: 'const x = 1;', expected: 0 },
    // The case the original line-based scan missed: prettier breaks long client
    // expressions exactly like this at 100 columns.
    {
      name: 'multiline call',
      fn: findDirectXAddCalls,
      source: 'await client\n  .xAdd("s", "*", f);',
      expected: 1,
    },
    {
      name: 'bracket access',
      fn: findDirectXAddCalls,
      source: 'await client["xAdd"]("s", "*", f);',
      expected: 1,
    },
    {
      name: 'multiline in comment',
      fn: findDirectXAddCalls,
      source: ' * client\n * .xAdd(...)',
      expected: 0,
    },
    {
      name: 'dynamic seam import',
      fn: findDynamicSeamRefs,
      source: "import { xAddBoundedDynamic } from 'x';",
      expected: 1,
    },
    {
      name: 'dynamic seam in comment',
      fn: findDynamicSeamRefs,
      source: ' * xAddBoundedDynamic is narrow',
      expected: 0,
    },
    {
      name: 'bounded seam is not the dynamic one',
      fn: findDynamicSeamRefs,
      source: 'xAddBounded(a, b, c);',
      expected: 0,
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const actual = testCase.fn(testCase.source).length;
    if (actual !== testCase.expected) {
      console.error(`  ✗ ${testCase.name}: expected ${testCase.expected} hit(s), got ${actual}`);
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

      const source = readFileSync(file, 'utf8');

      if (!ALLOW_LIST.has(rel)) {
        for (const hit of findDirectXAddCalls(source)) {
          violations.push({ file: rel, ...hit, rule: 'bare-xadd' });
        }
      }

      if (!DYNAMIC_SEAM_ALLOW_LIST.has(rel)) {
        for (const hit of findDynamicSeamRefs(source)) {
          violations.push({ file: rel, ...hit, rule: 'dynamic-seam' });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-stream-writes: stream write(s) bypass the retention seam.\n');
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  [${violation.rule}]`);
      console.error(`    ${violation.text}`);
    }
    console.error('\n  bare-xadd:    every stream write must go through `xAddBounded` from');
    console.error('                `@openlinker/shared/redis`, so an unbounded stream cannot');
    console.error('                exist. Add the stream to `REDIS_STREAM_NAMES` and give it a');
    console.error('                bound in `STREAM_BOUNDS` (#2163).');
    console.error('  dynamic-seam: `xAddBoundedDynamic` skips the call-site type check and');
    console.error('                exists only for `EventPublisherPort.publish`, whose stream');
    console.error('                name is dynamic by contract. Use `xAddBounded` instead.');
    process.exit(1);
  }

  if (scanned < MIN_SCANNED_FILES) {
    console.error(
      `✗ check-stream-writes: only ${scanned} source file(s) were scanned (expected at least ` +
        `${MIN_SCANNED_FILES}).\n\n  The walk found almost nothing, so a clean result means the ` +
        `scan is broken rather than\n  the tree. Check ROOTS/TEST_PATTERN and that ` +
        `${REPO_ROOT} is the repository root.`,
    );
    process.exit(1);
  }

  console.log(`✓ check-stream-writes: ${scanned} source file(s) checked. All writes are bounded.`);
}

main();
