#!/usr/bin/env node
/**
 * smart-test.mjs (#949)
 *
 * Diff-driven test selector for the pnpm workspace. Maps the files changed
 * vs a base ref to the *workspace packages* they belong to, then runs only
 * those packages' tests — narrowing within each package via
 * `jest --findRelatedTests`. Backend-only changes skip the flaky
 * `@openlinker/web` suite; pure frontend changes skip the slow Testcontainers
 * integration tier.
 *
 * Granularity note (#949 review B1). pnpm's finest test unit is the workspace
 * PACKAGE, not the bounded context — `libs/core` is a single package
 * (`@openlinker/core`) with subpath exports, so a change under
 * `libs/core/src/orders/` can only select the whole `@openlinker/core` Jest
 * project via `pnpm --filter`. Sub-package narrowing is delegated to
 * `jest --findRelatedTests <files>`, which `pnpm --filter` cannot do.
 *
 * Wired into `.husky/pre-commit` (unit-only, via `--no-integration`) so the
 * per-commit loop runs only the affected packages' tests. It is NOT added to
 * `check:invariants`, and `/work` Phase 4 + CI still run the full suite — the
 * hook is the fast local path, the full suite stays the safety net.
 *
 * Usage:
 *   pnpm smart-test                   # classify changes vs origin/main and run
 *   pnpm smart-test --dry-run         # print the plan, run nothing
 *   pnpm smart-test --no-integration  # skip the Testcontainers tier (used by the hook)
 *   pnpm smart-test --self-check      # exercise the pure classifier (no git, no fs)
 *   SMART_TEST_BASE_REF=<ref> pnpm smart-test   # override the base ref
 *
 * @module scripts
 */

import { spawnSync } from 'node:child_process';

const DEFAULT_BASE_REF = 'origin/main';

// Changes anywhere under these roots, or to a top-level config file, force a
// full run — they can affect any package transitively.
const WIDE_PREFIXES = ['libs/shared/', 'libs/test-kit/'];
const WIDE_BASENAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'turbo.json',
  'tsconfig.base.json',
  'tsconfig.json',
  'jest.config.cjs',
  'jest.config.js',
  'jest.setup.ts',
  '.eslintrc.js',
]);
// A change to a core top-level barrel or a context's Symbol-token file is a
// published-contract change → treat as wide.
const CORE_BARREL_RE = /^libs\/core\/src\/[^/]+\/index\.ts$/;
const CORE_TOKENS_RE = /^libs\/core\/src\/[^/]+\/[^/]+\.tokens\.ts$/;

// The single frontend package; everything else selected is "backend".
const FRONTEND_PACKAGE = 'apps/web';
const INT_SPEC_RE = /\.int-spec\.ts$/;

/** Map one repo-relative path to its workspace package root dir, or null. */
function packageRootFor(file) {
  // libs/integrations/<name>/... → libs/integrations/<name>
  const integ = file.match(/^(libs\/integrations\/[^/]+)\//);
  if (integ) return integ[1];
  // libs/<name>/... → libs/<name>  (core, plugin-sdk, …; shared/test-kit handled as wide)
  const lib = file.match(/^(libs\/[^/]+)\//);
  if (lib) return lib[1];
  // apps/<name>/... → apps/<name>
  const app = file.match(/^(apps\/[^/]+)\//);
  if (app) return app[1];
  return null;
}

function basename(file) {
  const i = file.lastIndexOf('/');
  return i === -1 ? file : file.slice(i + 1);
}

function isWideTrigger(file) {
  if (WIDE_PREFIXES.some((p) => file.startsWith(p))) return true;
  if (CORE_BARREL_RE.test(file) || CORE_TOKENS_RE.test(file)) return true;
  // Top-level config file (no directory component).
  if (!file.includes('/') && WIDE_BASENAMES.has(basename(file))) return true;
  return false;
}

/**
 * Pure classifier — no git, no filesystem. Given the list of changed
 * repo-relative paths, decide what to run. Returns:
 *   { scope: 'none'|'scoped'|'wide', packages: string[], runIntegration: boolean, reason }
 */
export function classify(changedFiles) {
  const files = changedFiles.filter(Boolean);
  if (files.length === 0) {
    return { scope: 'none', packages: [], runIntegration: false, reason: 'no changed files' };
  }

  const wideHit = files.find((f) => isWideTrigger(f));
  if (wideHit) {
    return {
      scope: 'wide',
      packages: [],
      runIntegration: true,
      reason: `wide trigger: ${wideHit} affects all packages`,
    };
  }

  const packages = new Set();
  for (const f of files) {
    const root = packageRootFor(f);
    if (root) packages.add(root);
  }

  if (packages.size === 0) {
    return {
      scope: 'none',
      packages: [],
      runIntegration: false,
      reason: 'changes touch no workspace package (e.g. docs / .claude only)',
    };
  }

  const selected = [...packages].sort();
  const backendSelected = selected.filter((p) => p !== FRONTEND_PACKAGE);
  // Integration tier runs when backend code is in scope, or any int-spec changed.
  const runIntegration = backendSelected.length > 0 || files.some((f) => INT_SPEC_RE.test(f));

  const skipped = selected.includes(FRONTEND_PACKAGE) && backendSelected.length === 0
    ? 'frontend-only — integration tier skipped'
    : backendSelected.length > 0 && !selected.includes(FRONTEND_PACKAGE)
      ? 'backend-only — apps/web suite skipped'
      : 'mixed frontend + backend';

  return {
    scope: 'scoped',
    packages: selected,
    runIntegration,
    reason: skipped,
  };
}

/** Collect changed repo-relative paths from git (committed vs base + working tree). */
function collectChangedFiles(baseRef) {
  const runs = [
    ['git', ['diff', '--name-only', `${baseRef}...HEAD`]],
    ['git', ['diff', '--name-only', 'HEAD']],
    ['git', ['diff', '--name-only', '--cached']],
    ['git', ['ls-files', '--others', '--exclude-standard']],
  ];
  const set = new Set();
  for (const [cmd, args] of runs) {
    const out = spawnSync(cmd, args, { encoding: 'utf8' });
    if (out.status !== 0) continue; // base ref may not exist locally; skip that source
    for (const line of out.stdout.split('\n')) {
      const f = line.trim();
      if (f) set.add(f);
    }
  }
  return [...set];
}

function relWithin(root, files) {
  return files
    .filter((f) => f.startsWith(`${root}/`))
    .map((f) => f.slice(root.length + 1));
}

function exec(cmd, args) {
  process.stdout.write(`\n$ ${cmd} ${args.join(' ')}\n`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' });
  return res.status ?? 1;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noIntegration = process.argv.includes('--no-integration');
  const baseRef = process.env.SMART_TEST_BASE_REF || DEFAULT_BASE_REF;
  const files = collectChangedFiles(baseRef);
  const plan = classify(files);
  const willRunIntegration = plan.runIntegration && !noIntegration;

  process.stdout.write(`smart-test: base ref ${baseRef}, ${files.length} changed file(s)\n`);
  process.stdout.write(`  scope: ${plan.scope} — ${plan.reason}\n`);
  if (plan.scope === 'scoped') {
    process.stdout.write(`  packages: ${plan.packages.join(', ')}\n`);
  }
  process.stdout.write(
    `  integration tier: ${
      willRunIntegration ? 'run' : plan.runIntegration ? 'skip (--no-integration)' : 'skip'
    }\n`,
  );

  if (dryRun) {
    process.stdout.write('\n(--dry-run: nothing executed)\n');
    return 0;
  }

  if (plan.scope === 'none') return 0;

  let failures = 0;

  if (plan.scope === 'wide') {
    failures += exec('pnpm', ['test']) === 0 ? 0 : 1;
  } else {
    for (const root of plan.packages) {
      const rel = relWithin(root, files);
      if (rel.length === 0) continue;
      // Narrow within the package to specs related to the changed files.
      const code = exec('pnpm', [
        '--filter',
        `./${root}`,
        'exec',
        'jest',
        '--findRelatedTests',
        ...rel,
        '--passWithNoTests',
      ]);
      if (code !== 0) failures += 1;
    }
  }

  if (willRunIntegration) {
    const code = exec('pnpm', ['test:integration']);
    if (code !== 0) failures += 1;
  }

  if (failures > 0) {
    process.stderr.write(`\nsmart-test: ${failures} test command(s) failed.\n`);
    return 1;
  }
  process.stdout.write('\nsmart-test: all selected tests passed.\n');
  return 0;
}

/** Self-test the pure classifier against synthetic diffs (no git, no fs). */
function selfCheck() {
  const cases = [
    {
      name: 'backend-only (core) → core package, skip web, integration on',
      files: ['libs/core/src/orders/application/services/order-ingestion.service.ts'],
      expect: (r) =>
        r.scope === 'scoped' &&
        r.packages.includes('libs/core') &&
        !r.packages.includes('apps/web') &&
        r.runIntegration === true,
    },
    {
      name: 'pure apps/web → web package, integration skipped',
      files: ['apps/web/src/features/orders/components/orders-table.tsx'],
      expect: (r) =>
        r.scope === 'scoped' &&
        r.packages.length === 1 &&
        r.packages[0] === 'apps/web' &&
        r.runIntegration === false,
    },
    {
      name: 'libs/shared change → wide',
      files: ['libs/shared/src/logging/logger.ts'],
      expect: (r) => r.scope === 'wide' && r.runIntegration === true,
    },
    {
      name: 'core top-level barrel → wide (published contract)',
      files: ['libs/core/src/inventory/index.ts'],
      expect: (r) => r.scope === 'wide',
    },
    {
      name: 'core tokens file → wide (published contract)',
      files: ['libs/core/src/inventory/inventory.tokens.ts'],
      expect: (r) => r.scope === 'wide',
    },
    {
      name: 'root package.json → wide',
      files: ['package.json'],
      expect: (r) => r.scope === 'wide',
    },
    {
      name: 'integration plugin change → its package, backend, integration on',
      files: ['libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts'],
      expect: (r) =>
        r.scope === 'scoped' &&
        r.packages.includes('libs/integrations/allegro') &&
        r.runIntegration === true,
    },
    {
      name: 'int-spec change alone → integration on',
      files: ['apps/api/test/integration/orders.int-spec.ts'],
      expect: (r) => r.scope === 'scoped' && r.runIntegration === true,
    },
    {
      name: 'mixed web + core → both packages, integration on (backend present)',
      files: [
        'apps/web/src/features/orders/index.ts',
        'libs/core/src/orders/domain/entities/order.entity.ts',
      ],
      expect: (r) =>
        r.scope === 'scoped' &&
        r.packages.includes('apps/web') &&
        r.packages.includes('libs/core') &&
        r.runIntegration === true,
    },
    {
      name: 'docs-only / .claude-only → none',
      files: ['docs/lessons.md', '.claude/commands/work.md'],
      expect: (r) => r.scope === 'none' && r.runIntegration === false,
    },
    {
      name: 'empty diff → none',
      files: [],
      expect: (r) => r.scope === 'none',
    },
  ];

  const failures = [];
  for (const c of cases) {
    let ok = false;
    try {
      ok = c.expect(classify(c.files));
    } catch {
      ok = false;
    }
    if (!ok) failures.push(`  ✗ ${c.name}`);
  }

  if (failures.length === 0) {
    process.stdout.write(`✓ smart-test --self-check: ${cases.length} classifier case(s) passed.\n`);
    return 0;
  }
  process.stderr.write('✗ smart-test --self-check failed:\n');
  process.stderr.write(`${failures.join('\n')}\n`);
  return 1;
}

const code = process.argv.includes('--self-check') ? selfCheck() : main();
process.exit(code);
