import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { createOgMetaPlugin } from './src/build-time/og-meta';

// Anchored on the config file itself, not `process.cwd()`: the build is
// invoked both from the package dir (`pnpm --filter`) and from the repo root,
// and only one of those makes a cwd-relative env lookup find `.env*`.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

// The product release version lives on the ROOT package.json (release-please
// is configured with a single "." package, see release-please-config.json) —
// not apps/web/package.json, which release-please never touches. Read it at
// build time so the version shown in the app is always the one the release
// line actually cut, with no manual sync step.
const ROOT_PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const APP_VERSION = (
  JSON.parse(readFileSync(ROOT_PACKAGE_JSON_PATH, 'utf-8')) as { version: string }
).version;

export default defineConfig(({ mode }) => {
  // #2174: every OG token is resolved HERE rather than through Vite's native
  // `%VITE_FOO%` HTML substitution, because that path needs the variable to
  // exist — and an unset one is only a WARNING, so the build stays green and
  // ships the literal `%VITE_OG_TITLE_PREFIX%` into the share card. Defaulting
  // in code makes the production shape independent of whether any `.env` file
  // reached the builder, which the Docker build context (root `.dockerignore`
  // excludes `.env.*`) guarantees it did not.
  //
  // `loadEnv` already folds prefix-matching `process.env` entries over the
  // `.env*` files, so a `--build-arg`-supplied value wins with no extra
  // precedence handling here.
  const env = loadEnv(mode, CONFIG_DIR, 'VITE_');

  return {
    // #2174: token resolution lives in `src/build-time/og-meta.ts` so it can be
    // unit-tested (this module reads `import.meta.url`, which is not a `file:`
    // URL under the test environment, so a spec cannot import it).
    plugins: [react(), createOgMetaPlugin(env)],
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    server: {
      port: 4173,
    },
    test: {
      environment: 'happy-dom',
      // Self-hosted CI runner (added 2026-04 via 444244f) is materially slower
      // than ubuntu-latest; RTL tests with multiple async state transitions
      // (wizards, dialogs + API calls, nested queries) can exceed the 5000ms
      // vitest default. Local runs complete in 2–3s per test; CI stretches
      // each transform/import pass by ~20×. Bumping to 10s keeps hangs
      // failing visibly while accommodating the runner.
      testTimeout: 10000,
      teardownTimeout: 10000,
      setupFiles: './src/test/setup.ts',
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
      },
    },
  };
});
