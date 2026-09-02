#!/usr/bin/env node
/**
 * check-contract-suite-not-in-production.mjs
 *
 * Lint-time invariant for #2404 (`W3a-15`) AC-3: the port-contract suite must be
 * reachable ONLY from the `testing` sub-barrel, never from a runtime path.
 *
 * ## Why this needs a guard at all
 *
 * A port-contract suite names ambient Jest globals (`describe` / `it` /
 * `expect`), which exist only under a test runner. `@openlinker/core` is a
 * PRODUCTION dependency of every host app and every plugin, so a runtime
 * `require()` that reaches this code dies with `describe is not defined`, at the
 * far end of a stack trace that explains nothing about the real mistake. The
 * `identifier-mapping` / `integrations` / `events` / `inventory` / `returns`
 * testing sub-barrels carry no such hazard — they export plain fixtures and
 * fakes — which is why this is the first one to need asserting.
 *
 * ## THREE structural facts, none of them a naive substring scan
 *
 *   1. `libs/core/package.json` exports the `./fulfillment/testing` subpath.
 *      Without it the suite is unreachable even from a spec, and the whole
 *      separation is moot.
 *   2. The PRODUCTION barrel `libs/core/src/fulfillment/index.ts` does NOT
 *      re-export `./testing`. This is the load-bearing one: a single
 *      `export * from './testing'` would put Jest globals on the surface every
 *      host imports, and nothing else in the build would notice.
 *   3. No production source file imports the testing subpath or the suite. Test
 *      files are exempt — they are the intended consumer.
 *
 * ## WHAT THIS DOES NOT CATCH — an overstated gate is worse than none
 *
 *   - It does not prove the suite is correct, only that it is quarantined.
 *   - It is textual: comments are STRIPPED before scanning, because the
 *     docblocks in `libs/test-kit/src/index.ts` and elsewhere legitimately name
 *     module paths in prose, and a substring scan would flag them. Only real
 *     `import` / `require` / dynamic-`import()` forms count.
 *   - It says nothing about `libs/integrations/{ksef,subiekt}`'s own contract
 *     suites. Those live in plugin packages with their own `./testing`
 *     subpaths; extending this guard to them is a separate, larger change and
 *     is deliberately not claimed here.
 *
 * "MATCHED NOTHING" is a FAILURE for facts 1 and 2: a moved or renamed file
 * exits non-zero rather than silently asserting over an empty string forever
 * (the #2673 defect this repo has already shipped once).
 *
 * Usage:
 *   node scripts/check-contract-suite-not-in-production.mjs
 *   node scripts/check-contract-suite-not-in-production.mjs --self-check
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const DOCS_REF = 'docs/plans/implementation-plan-port-contract-test-kit.md';
const PKG_FILE = join('libs', 'core', 'package.json');
const BARREL_FILE = join('libs', 'core', 'src', 'fulfillment', 'index.ts');
const SUBPATH = './fulfillment/testing';
const SCAN_ROOTS = [join('libs'), join('apps')];

/** Strip line and block comments so prose naming a path is never a match. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Fact 1 — the subpath is exported. */
export function findsExportedSubpath(pkgJsonText) {
  let parsed;
  try {
    parsed = JSON.parse(pkgJsonText);
  } catch {
    return false;
  }
  return Boolean(parsed?.exports?.[SUBPATH]);
}

/** Fact 2 — the production barrel does not re-export the testing directory. */
export function barrelReexportsTesting(barrelText) {
  const code = stripComments(barrelText);
  return /(^|\n)\s*export\s[\s\S]*?from\s+['"]\.\/testing(\/[^'"]*)?['"]/.test(code);
}

/**
 * Fact 3 — real import forms only, on stripped source.
 * Matches `from '…fulfillment/testing…'`, `require('…')` and `import('…')`.
 */
export function importsTestingSubpath(source) {
  const code = stripComments(source);
  const specifier = /['"]([^'"]*fulfillment\/testing[^'"]*)['"]/;
  for (const line of code.split('\n')) {
    if (!/\b(from|require|import)\b/.test(line)) continue;
    if (specifier.test(line)) return true;
  }
  return false;
}

function isTestFile(relPath) {
  const parts = relPath.split(sep);
  return (
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.int-spec.ts') ||
    relPath.endsWith('.e2e-spec.ts') ||
    relPath.endsWith('.test.ts') ||
    parts.includes('__tests__') ||
    parts.includes('testing') ||
    parts.includes('test')
  );
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      await walk(full, out);
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function selfCheck() {
  const failures = [];

  if (findsExportedSubpath('{"exports":{"./other":{}}}')) {
    failures.push('findsExportedSubpath returned true for a package.json without the subpath');
  }
  if (!findsExportedSubpath(`{"exports":{"${SUBPATH}":{}}}`)) {
    failures.push('findsExportedSubpath returned false for a package.json WITH the subpath');
  }
  if (!barrelReexportsTesting("export * from './testing';")) {
    failures.push('barrelReexportsTesting missed a real re-export');
  }
  if (barrelReexportsTesting("// export * from './testing';")) {
    failures.push('barrelReexportsTesting matched a COMMENTED re-export');
  }
  if (barrelReexportsTesting("export * from './domain/types/routing.types';")) {
    failures.push('barrelReexportsTesting matched an unrelated export');
  }
  if (!importsTestingSubpath("import { x } from '@openlinker/core/fulfillment/testing';")) {
    failures.push('importsTestingSubpath missed a real import');
  }
  if (importsTestingSubpath(" * consumed from @openlinker/core/fulfillment/testing by specs")) {
    failures.push('importsTestingSubpath matched a docblock mention (the #2404 R6 trap)');
  }
  if (importsTestingSubpath("import { y } from '@openlinker/core/fulfillment';")) {
    failures.push('importsTestingSubpath matched the production barrel');
  }

  if (failures.length > 0) {
    console.error('check-contract-suite-not-in-production SELF-CHECK FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-contract-suite-not-in-production self-check OK (8 assertions)');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    await selfCheck();
    return;
  }

  const problems = [];

  let pkgText = null;
  try {
    pkgText = await readFile(join(repoRoot, PKG_FILE), 'utf8');
  } catch {
    problems.push(`${PKG_FILE} could not be read — did the file move?`);
  }
  if (pkgText !== null && !findsExportedSubpath(pkgText)) {
    problems.push(`${PKG_FILE} does not export "${SUBPATH}" — the suite is unreachable even from a spec`);
  }

  let barrelText = null;
  try {
    barrelText = await readFile(join(repoRoot, BARREL_FILE), 'utf8');
  } catch {
    problems.push(`${BARREL_FILE} could not be read — did the file move?`);
  }
  if (barrelText !== null && barrelReexportsTesting(barrelText)) {
    problems.push(
      `${BARREL_FILE} re-exports ./testing — that puts Jest globals (describe/it/expect) on the ` +
        'production barrel every host app and plugin imports',
    );
  }

  const files = [];
  for (const root of SCAN_ROOTS) {
    await walk(join(repoRoot, root), files);
  }

  let scanned = 0;
  for (const full of files) {
    const relPath = relative(repoRoot, full);
    if (isTestFile(relPath)) continue;
    scanned += 1;
    let source;
    try {
      source = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    if (importsTestingSubpath(source)) {
      problems.push(`${relPath} imports the testing sub-barrel from production source`);
    }
  }

  if (scanned === 0) {
    problems.push('scanned no production files — the walker matched nothing, which is a defect, not a pass');
  }

  if (problems.length > 0) {
    console.error(`check-contract-suite-not-in-production FAILED (${DOCS_REF}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `check-contract-suite-not-in-production OK (subpath exported, barrel clean, ${scanned} production files scanned)`,
  );
}

await main();
