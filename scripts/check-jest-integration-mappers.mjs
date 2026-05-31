#!/usr/bin/env node
/**
 * check-jest-integration-mappers.mjs
 *
 * Lint-time invariant guarding against jest-integration `moduleNameMapper`
 * drift (#917). Each host app's `test/jest-integration.cjs` hand-maintains a
 * `moduleNameMapper` that source-maps every `@openlinker/*` workspace package
 * the app's module graph pulls in (so a *fresh, un-built* worktree can resolve
 * them via `src/` instead of a missing `dist/`).
 *
 * The list silently drifts: a plugin can be wired into `apps/<app>/src/plugins.ts`
 * (and thus into the Nest module graph) WITHOUT a matching mapper entry. CI masks
 * it because the integration job builds `dist` first, but a fresh worktree then
 * fails EVERY integration test with `Cannot find module '@openlinker/integrations-…'
 * from 'src/plugins.ts'`. This bit #916 (api missing `inpost`) and #786 (worker
 * missing `integrations-ai`).
 *
 * Rule. For each app in `APPS`, every package in
 *   `REQUIRED_BASE` ∪ { `@openlinker/integrations-*` imported by its plugins.ts }
 * MUST have BOTH a `^<pkg>$` and a `^<pkg>/(.*)$` entry in that app's
 * `jest-integration.cjs` `moduleNameMapper` (a partial mapping still breaks
 * subpath imports), AND the bare entry's target file must exist (catches a
 * typo'd `src` path). Failures name the app, the package, and the fix.
 *
 * Source of truth = `plugins.ts`, NOT the app's `package.json` `dependencies`:
 * in this pnpm monorepo apps under-declare their `@openlinker/*` deps (e.g.
 * `apps/worker` imports `integrations-allegro` + `integrations-ai` in plugins.ts
 * but lists neither), so a package.json-based check would miss the very drift
 * this guard targets.
 *
 * Limitation. Transitive workspace deps beyond `REQUIRED_BASE` are not
 * auto-discovered — `REQUIRED_BASE` pins the universally-required foundation
 * (`core` / `shared` / `plugin-sdk`, pulled in by AppModule + every plugin);
 * the plugins.ts scan covers the integration packages that actually drift.
 *
 * Run with `--self-check` to exercise the pure parsers against synthetic inputs
 * (no filesystem) — mirrors `check-service-interfaces.mjs --self-check`.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const require = createRequire(import.meta.url);

/** Host apps that boot a Nest module graph in their integration harness. */
const APPS = [
  {
    name: 'api',
    pluginsTs: 'apps/api/src/plugins.ts',
    jestConfig: 'apps/api/test/jest-integration.cjs',
  },
  {
    name: 'worker',
    pluginsTs: 'apps/worker/src/plugins.ts',
    jestConfig: 'apps/worker/test/jest-integration.cjs',
  },
];

/**
 * Workspace packages every plugin-loading app must source-map regardless of
 * plugins.ts: AppModule + every integration plugin pull these in transitively,
 * and none ships a committed `dist` for a fresh worktree.
 */
const REQUIRED_BASE = ['@openlinker/core', '@openlinker/shared', '@openlinker/plugin-sdk'];

const DOCS_REF = 'docs/testing-guide.md § jest-integration moduleNameMapper guard (#917)';

/** `@openlinker/integrations-ai` → `libs/integrations/ai/src`; `@openlinker/plugin-sdk` → `libs/plugin-sdk/src`. */
function pkgToLibSrcDir(pkg) {
  const name = pkg.replace('@openlinker/', '');
  return name.startsWith('integrations-')
    ? `libs/integrations/${name.slice('integrations-'.length)}/src`
    : `libs/${name}/src`;
}

/**
 * Extract `@openlinker/integrations-*` package specifiers imported by a
 * plugins.ts file. Assumes plugins.ts imports the package ROOT (the Nest
 * module), never a subpath — `[a-z0-9-]+` stops at `/`, so a hypothetical
 * `…/integrations-ai/foo` import would not be detected.
 */
function parsePluginPackages(content) {
  const re = /from\s+['"](@openlinker\/integrations-[a-z0-9-]+)['"]/g;
  const pkgs = new Set();
  let m;
  while ((m = re.exec(content)) !== null) pkgs.add(m[1]);
  return pkgs;
}

/**
 * Parse a Jest `moduleNameMapper` into `Map<pkg, { bareTarget, hasSub }>` for
 * every `@openlinker/*` package: `bareTarget` is the `^pkg$` mapping's resolved
 * target (string) or `undefined`; `hasSub` is whether a `^pkg/(.*)$` entry exists.
 */
function parseMapper(moduleNameMapper) {
  const map = new Map();
  for (const [key, value] of Object.entries(moduleNameMapper ?? {})) {
    let body = key;
    if (body.startsWith('^')) body = body.slice(1);
    if (body.endsWith('$')) body = body.slice(0, -1);
    if (!body.startsWith('@openlinker/')) continue;
    const isSub = body.endsWith('/(.*)');
    const pkg = isSub ? body.slice(0, -'/(.*)'.length) : body;
    const entry = map.get(pkg) ?? { bareTarget: undefined, hasSub: false };
    if (isSub) entry.hasSub = true;
    else entry.bareTarget = typeof value === 'string' ? value : undefined;
    map.set(pkg, entry);
  }
  return map;
}

/**
 * Pure classifier (no fs — `targetExists` is injected). For each required
 * package, returns `{ missing, broken }`: `missing` = not fully mapped (lacks a
 * bare or subpath entry); `broken` = fully mapped but the bare target file is
 * absent (typo'd path).
 */
function classifyRequired(requiredPkgs, mapper, targetExists) {
  const missing = [];
  const broken = [];
  for (const pkg of [...requiredPkgs].sort()) {
    const entry = mapper.get(pkg);
    if (!entry || entry.bareTarget === undefined || !entry.hasSub) {
      missing.push(pkg);
    } else if (!targetExists(entry.bareTarget)) {
      broken.push({ pkg, target: entry.bareTarget });
    }
  }
  return { missing, broken };
}

/** The two `moduleNameMapper` lines a maintainer should paste for `pkg`. */
function suggestedMapperLines(pkg) {
  const dir = pkgToLibSrcDir(pkg);
  return [
    `'^${pkg}$': path.resolve(__dirname, '../../../${dir}/index.ts'),`,
    `'^${pkg}/(.*)$': path.resolve(__dirname, '../../../${dir}/$1'),`,
  ];
}

async function main() {
  const violations = [];

  for (const app of APPS) {
    const pluginsContent = await readFile(join(repoRoot, app.pluginsTs), 'utf8');
    const required = new Set([...REQUIRED_BASE, ...parsePluginPackages(pluginsContent)]);

    const cfgPath = join(repoRoot, app.jestConfig);
    delete require.cache[cfgPath];
    const cfg = require(cfgPath);
    const mapper = parseMapper(cfg.moduleNameMapper);
    const { missing, broken } = classifyRequired(required, mapper, existsSync);

    for (const pkg of missing) violations.push({ app, kind: 'missing', pkg });
    for (const b of broken) violations.push({ app, kind: 'broken', pkg: b.pkg, target: b.target });
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-jest-integration-mappers: ${APPS.length} app(s) checked. ` +
        `All plugins.ts integrations + base deps are source-mapped.`
    );
    process.exit(0);
  }

  console.error(
    `✗ check-jest-integration-mappers: ${violations.length} moduleNameMapper problem(s).\n`
  );
  for (const v of violations) {
    if (v.kind === 'missing') {
      console.error(
        `  ${v.app.name}: ${v.pkg} is in the app's plugin graph but not source-mapped in ${v.app.jestConfig}`
      );
      console.error('    add inside moduleNameMapper:');
      for (const line of suggestedMapperLines(v.pkg)) console.error(`      ${line}`);
    } else {
      console.error(
        `  ${v.app.name}: ${v.pkg} is mapped in ${v.app.jestConfig} but its target does not exist:`
      );
      console.error(`      ${v.target}`);
      console.error('    fix the path in moduleNameMapper.');
    }
    console.error('');
  }
  console.error(`  docs: ${DOCS_REF}`);
  process.exit(1);
}

/** Self-test the pure parsers against synthetic inputs — no filesystem. */
function selfCheck() {
  const plugins = parsePluginPackages(
    [
      `import type { PluginEntry } from '@openlinker/core/integrations';`,
      `import { A } from '@openlinker/integrations-allegro';`,
      `import { B } from "@openlinker/integrations-ai";`,
    ].join('\n')
  );

  const mapper = parseMapper({
    '^@openlinker/integrations-ai$': '/abs/libs/integrations/ai/src/index.ts',
    '^@openlinker/integrations-ai/(.*)$': '/abs/libs/integrations/ai/src/$1',
    '^@openlinker/integrations-allegro$': '/abs/x', // bare only — partial
    '^@openlinker/integrations-prestashop$': '/abs/typo/index.ts', // both forms, bad target
    '^@openlinker/integrations-prestashop/(.*)$': '/abs/typo/$1',
    '^@openlinker/core$': '/abs/libs/core/src/index.ts',
    '^@openlinker/core/(.*)$': '/abs/libs/core/src/$1',
  });

  const allExist = () => true;
  const existsExceptTypo = (p) => !p.includes('/typo/');

  const c1 = classifyRequired(
    new Set(['@openlinker/integrations-ai', '@openlinker/integrations-allegro', '@openlinker/core']),
    mapper,
    allExist
  );
  const c2 = classifyRequired(new Set(['@openlinker/integrations-prestashop']), mapper, existsExceptTypo);

  const cases = [
    ['parse: finds integrations-*, excludes @openlinker/core/integrations', plugins.size === 2],
    ['parse: includes allegro + ai', plugins.has('@openlinker/integrations-allegro') && plugins.has('@openlinker/integrations-ai')],
    ['mapper: both forms recorded', mapper.get('@openlinker/integrations-ai')?.hasSub === true && typeof mapper.get('@openlinker/integrations-ai')?.bareTarget === 'string'],
    ['classify: bare-only → missing', c1.missing.includes('@openlinker/integrations-allegro')],
    ['classify: fully-mapped + target exists → clean', !c1.missing.includes('@openlinker/core') && c1.broken.length === 0],
    ['classify: fully-mapped + missing target → broken', c2.broken.length === 1 && c2.broken[0].pkg === '@openlinker/integrations-prestashop'],
    ['libSrcDir: integrations', pkgToLibSrcDir('@openlinker/integrations-ai') === 'libs/integrations/ai/src'],
    ['libSrcDir: base pkg', pkgToLibSrcDir('@openlinker/plugin-sdk') === 'libs/plugin-sdk/src'],
  ];

  const failures = cases.filter(([, ok]) => !ok).map(([name]) => `  ✗ ${name}`);
  if (failures.length === 0) {
    console.log(`✓ check-jest-integration-mappers --self-check: ${cases.length} case(s) passed.`);
    process.exit(0);
  }
  console.error('✗ check-jest-integration-mappers --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
Promise.resolve(run()).catch((err) => {
  console.error('check-jest-integration-mappers: fatal error:', err);
  process.exit(1);
});
