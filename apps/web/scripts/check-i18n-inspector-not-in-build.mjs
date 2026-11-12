#!/usr/bin/env node
/**
 * The missing-translation inspector (#4017) is never in a production build.
 *
 * Builds the app with VITE_I18N_HIGHLIGHT_MISSING=true into a temporary folder
 * and fails if any emitted file contains the inspector's sentinel string.
 * `main.tsx` imports the inspector only behind `import.meta.env.DEV`, which is
 * a literal `false` in a production build, so the variable alone must not be
 * able to ship it. The check first confirms the sentinel still exists in the
 * source, so a renamed sentinel cannot turn it into a check that always passes.
 *
 * Usage: node apps/web/scripts/check-i18n-inspector-not-in-build.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = '__OL_I18N_MISSING_INSPECTOR__';
const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(WEB_DIR, 'src/shared/i18n/missing-inspector/index.ts');

if (!readFileSync(ENTRY, 'utf8').includes(`'${SENTINEL}'`)) {
  console.error(`✗ ${ENTRY} no longer declares the sentinel ${SENTINEL}; update this check.`);
  process.exit(1);
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const outDir = mkdtempSync(join(tmpdir(), 'ol-web-inspector-check-'));
try {
  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB_DIR,
    stdio: 'inherit',
    env: { ...process.env, VITE_I18N_HIGHLIGHT_MISSING: 'true' },
  });
  if (build.status !== 0) {
    console.error('✗ vite build failed.');
    process.exit(build.status ?? 1);
  }
  const leaks = filesUnder(outDir).filter((file) => readFileSync(file, 'utf8').includes(SENTINEL));
  if (leaks.length > 0) {
    console.error(`✗ the missing-translation inspector is in the production build:\n  ${leaks.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ check-i18n-inspector-not-in-build: the inspector is not in a production build.');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
