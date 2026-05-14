#!/usr/bin/env node
/**
 * Libs Build-Script Invariant (#602)
 *
 * Asserts every workspace package under `libs/*` and `libs/integrations/*`
 * declares a non-empty `scripts.build`. Closes the silent-skip gap in
 * `pnpm -r --filter "./libs/**" build`:
 *
 *   $ pnpm -r --filter "./libs/**" run nonexistent-script
 *   Scope: 7 of 11 workspace projects
 *   None of the selected packages has a "nonexistent-script" script
 *   exit=0
 *
 * pnpm silently skips packages that lack the script. A contributor adding
 * `libs/integrations/shopify/package.json` with a typo'd `"buld"` (or no
 * build script at all) would have CI skip the build for that package — the
 * runtime breakage surfaces somewhere downstream rather than at the build
 * step. This invariant fails `pnpm lint` immediately on the offending
 * package.json so the issue is caught at the same point the contributor
 * runs their pre-commit hook.
 *
 * Chained into the root `check:invariants` command. Mirrors the shape of
 * `scripts/check-create-adapter.mjs`.
 *
 * @module scripts
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// Mirrors the pnpm-workspace.yaml `libs/*` and `libs/integrations/*` globs.
// Order matters for the diagnostic message — top-level libs first, then
// nested integration packages.
const LIBS_PARENTS = ['libs', 'libs/integrations'];

const errors = [];

async function listChildPackageDirs(parent) {
  const parentAbs = join(REPO_ROOT, parent);
  const entries = await readdir(parentAbs, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip `libs/integrations` when scanning `libs` — the nested glob handles it.
    if (parent === 'libs' && entry.name === 'integrations') continue;
    dirs.push(join(parent, entry.name));
  }
  return dirs.sort();
}

async function main() {
  let packagesChecked = 0;
  for (const parent of LIBS_PARENTS) {
    const children = await listChildPackageDirs(parent);
    for (const child of children) {
      const pkgPath = join(REPO_ROOT, child, 'package.json');
      let pkg;
      try {
        const raw = await readFile(pkgPath, 'utf8');
        pkg = JSON.parse(raw);
      } catch (err) {
        // Not a package directory (no package.json) — silently skip. Same
        // posture as pnpm's workspace resolver, so the invariant covers
        // exactly the set the glob targets.
        if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
          continue;
        }
        throw err;
      }
      packagesChecked++;
      const buildScript = pkg.scripts?.build;
      if (
        !buildScript ||
        typeof buildScript !== 'string' ||
        buildScript.trim() === ''
      ) {
        errors.push(
          `${child}/package.json: missing or empty "scripts.build" — pnpm -r --filter "./libs/**" build will silently skip this package`,
        );
      }
    }
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      process.stderr.write(`check-libs-build-scripts: ${msg}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-libs-build-scripts: OK (${packagesChecked} packages)\n`,
  );
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `check-libs-build-scripts: unexpected error — ${message}\n`,
  );
  process.exit(1);
}
