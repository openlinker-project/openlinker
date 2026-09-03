#!/usr/bin/env node
/**
 * check-jest-esm-deps.mjs
 *
 * Guards the fan-out of `jest.esm-deps.cjs` (#2233 / PR #2812 review). That
 * module's own docblock states the rule: "Any jest config whose module graph
 * can reach `@openlinker/shared/html` must merge this in — via babel-jest for
 * `.js` files plus a `transformIgnorePatterns` override — or Jest throws
 * `SyntaxError: Cannot use import statement outside a module` trying to load
 * htmlparser2's ESM build." That rule was hand-applied to 19 jest configs and
 * missed a 20th (`libs/oms/jest.config.mjs`) despite `libs/oms/package.json`
 * declaring `@openlinker/shared` as a dependency — the exact drift a
 * hand-maintained per-package list invites, and the reason this repo's
 * standard answer is a `scripts/check-*.mjs` invariant (the
 * `check-jest-integration-mappers.mjs` precedent, #917).
 *
 * Rule. For every jest config discovered under a package whose `package.json`
 * declares `@openlinker/shared` as a runtime dependency (or IS
 * `@openlinker/shared` itself, which cannot declare a dependency on itself but
 * is the origin of the ESM-only chain), the config file must:
 *   (a) require/import `jest.esm-deps.cjs` (any relative depth), AND
 *   (b) reference both of its exports, `ESM_DEPS_TRANSFORM_IGNORE_PATTERN`
 *       and `esmDepsJsTransform`, at least once each beyond the import line
 *       itself (i.e. actually spread/use them, not just destructure and
 *       discard).
 *
 * Discovered jest configs = `jest.config.{js,mjs,cjs}` directly at a package
 * root, plus any `jest-integration.cjs` anywhere under the package (today:
 * `apps/{api,worker}/test/jest-integration.cjs`) — a second, hand-rolled
 * config for the SAME package's integration suite, reachable through the same
 * module graph.
 *
 * `libs/test-kit` is correctly excluded: it declares no `@openlinker/shared`
 * dependency (only peers unrelated to it), so its module graph cannot reach
 * `@openlinker/shared/html`.
 *
 * Chained into the root `check:invariants` command.
 *
 * Usage:
 *   node scripts/check-jest-esm-deps.mjs
 *   node scripts/check-jest-esm-deps.mjs --self-check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Mirrors the `pnpm-workspace.yaml` globs, hardcoded per the
// `check-workspace-dep-declarations.mjs` precedent (the repo ships no YAML
// parser).
const WORKSPACE_PARENTS = ['apps', 'libs', 'libs/integrations'];

const JEST_CONFIG_NAMES = new Set(['jest.config.js', 'jest.config.mjs', 'jest.config.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

const DOCS_REF = 'jest.esm-deps.cjs (its own docblock states the merge rule)';

/** List immediate subdirectories of `parent` that carry a `package.json`. */
function discoverPackageDirs(parent) {
  const abs = join(REPO_ROOT, parent);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => join(parent, e.name))
    .filter((dir) => statSync(join(REPO_ROOT, dir, 'package.json'), { throwIfNoEntry: false }));
}

/**
 * Every workspace package directory (relative to repo root) that has its own
 * `package.json`.
 */
function discoverAllPackageDirs() {
  const dirs = new Set();
  for (const parent of WORKSPACE_PARENTS) {
    for (const dir of discoverPackageDirs(parent)) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * True iff the package at `pkgDir` is either `@openlinker/shared` itself or
 * declares it as a runtime dependency — the population whose module graph can
 * reach `@openlinker/shared/html`.
 */
function reachesSharedHtml(pkgDir) {
  const pkgJsonPath = join(REPO_ROOT, pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  if (pkg.name === '@openlinker/shared') return true;
  return Boolean(pkg.dependencies && pkg.dependencies['@openlinker/shared']);
}

/** Recursively find files named `jest-integration.cjs` under `dir`. */
function findJestIntegrationConfigs(absDir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findJestIntegrationConfigs(abs));
    } else if (entry.isFile() && entry.name === 'jest-integration.cjs') {
      found.push(abs);
    }
  }
  return found;
}

/** Every jest config file (relative to repo root) belonging to `pkgDir`. */
function findJestConfigs(pkgDir) {
  const absPkgDir = join(REPO_ROOT, pkgDir);
  const configs = [];

  let rootEntries;
  try {
    rootEntries = readdirSync(absPkgDir, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && JEST_CONFIG_NAMES.has(entry.name)) {
      configs.push(join(absPkgDir, entry.name));
    }
  }

  configs.push(...findJestIntegrationConfigs(absPkgDir));

  return configs;
}

/**
 * Pure classifier (no fs). Given a jest config's source text, decide whether
 * it merges `jest.esm-deps.cjs` in per the two-part rule stated above.
 */
function classifyConfigContent(content) {
  const importsEsmDeps = /(?:require\(|from\s+)['"][^'"]*jest\.esm-deps\.cjs['"]/.test(content);
  if (!importsEsmDeps) {
    return { ok: false, reason: 'does not require/import jest.esm-deps.cjs' };
  }

  // Both names must appear at least twice: once destructured out of the
  // import/require, and at least once more where they are actually spread
  // into `transform` / `transformIgnorePatterns` — catches an import that is
  // destructured and then never used.
  const countOccurrences = (name) => (content.match(new RegExp(name, 'g')) ?? []).length;

  if (countOccurrences('esmDepsJsTransform') < 2) {
    return { ok: false, reason: 'imports jest.esm-deps.cjs but never uses esmDepsJsTransform in transform' };
  }
  if (countOccurrences('ESM_DEPS_TRANSFORM_IGNORE_PATTERN') < 2) {
    return {
      ok: false,
      reason: 'imports jest.esm-deps.cjs but never uses ESM_DEPS_TRANSFORM_IGNORE_PATTERN in transformIgnorePatterns',
    };
  }

  return { ok: true };
}

function relPath(absPath) {
  return absPath.startsWith(REPO_ROOT) ? absPath.slice(REPO_ROOT.length + 1) : absPath;
}

function main() {
  const violations = [];
  let checked = 0;

  for (const pkgDir of discoverAllPackageDirs()) {
    if (!reachesSharedHtml(pkgDir)) continue;

    const configs = findJestConfigs(pkgDir);
    for (const configPath of configs) {
      checked += 1;
      const content = readFileSync(configPath, 'utf8');
      const result = classifyConfigContent(content);
      if (!result.ok) {
        violations.push({ file: relPath(configPath), reason: result.reason });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-jest-esm-deps: ${checked} jest config(s) checked across every package reaching @openlinker/shared/html. ` +
        'All merge in jest.esm-deps.cjs.'
    );
    process.exit(0);
  }

  console.error(`✗ check-jest-esm-deps: ${violations.length} jest config(s) missing the ESM-deps merge.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.reason}`);
    console.error('    fix: merge in jest.esm-deps.cjs — see any already-updated jest.config.mjs for the shape:');
    console.error(
      "      import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '<relative path to>/jest.esm-deps.cjs';"
    );
    console.error("      transform: { ..., '^.+\\\\.js$': esmDepsJsTransform },");
    console.error('      transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],');
    console.error('');
  }
  console.error(`  docs: ${DOCS_REF}`);
  process.exit(1);
}

/** Self-test the pure parts against synthetic inputs — no filesystem. */
function selfCheck() {
  const good = `
    const { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } = require('../../jest.esm-deps.cjs');
    module.exports = {
      transform: { '^.+\\\\.ts$': 'ts-jest', '^.+\\\\.js$': esmDepsJsTransform },
      transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
    };
  `;
  const missingImport = `
    module.exports = { transform: { '^.+\\\\.ts$': 'ts-jest' } };
  `;
  const importedButUnused = `
    const { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } = require('../../jest.esm-deps.cjs');
    module.exports = { transform: { '^.+\\\\.ts$': 'ts-jest' } };
  `;
  const esmImportForm = `
    import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '../../jest.esm-deps.cjs';
    export default {
      transform: { '^.+\\\\.js$': esmDepsJsTransform },
      transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
    };
  `;

  const cases = [
    ['fully merged (require form) → ok', classifyConfigContent(good).ok === true],
    ['no import at all → not ok', classifyConfigContent(missingImport).ok === false],
    ['imported but never spread → not ok', classifyConfigContent(importedButUnused).ok === false],
    ['fully merged (import form) → ok', classifyConfigContent(esmImportForm).ok === true],
  ];

  const failures = cases.filter(([, ok]) => !ok).map(([name]) => `  ✗ ${name}`);
  if (failures.length === 0) {
    console.log(`✓ check-jest-esm-deps --self-check: ${cases.length} case(s) passed.`);
    process.exit(0);
  }
  console.error('✗ check-jest-esm-deps --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
run();
