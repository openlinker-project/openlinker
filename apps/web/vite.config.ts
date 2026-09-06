import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { createOgMetaPlugin } from './src/build-time/og-meta';

// Anchored on the config file itself, not `process.cwd()`: the build is
// invoked both from the package dir (`pnpm --filter`) and from the repo root,
// and only one of those makes a cwd-relative env lookup find `.env*`.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

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
    server: {
      port: 4173,
    },
    build: {
      rollupOptions: {
        output: {
          // #2866: with no manualChunks, react/react-dom, Radix and Tiptap
          // were interleaved into the app's own route chunks (verified:
          // `ui-*.js` carried both `@radix-ui` and `@tiptap` alongside
          // shared/ui code, `index-*.js` carried `react-dom`). Every one of
          // these vendor packages changes far less often than app code, so
          // bundling them together means a one-line app change invalidates
          // the browser cache for React itself on every deploy. Splitting
          // them into their own named, content-hashed chunks lets a repeat
          // visitor keep the vendor chunk cached across releases that only
          // touch app code — this does not shrink what a cold visitor
          // downloads, it changes what a WARM visitor re-downloads.
          //
          // Grouped by "how often does this change", not by package name:
          // react-vendor and editor-vendor are the two heaviest, most
          // stable groups (confirmed via `check-bundle-budgets.mjs`'s
          // baseline measurement); everything else under node_modules falls
          // into one shared vendor chunk rather than one chunk per package,
          // which would multiply small-file HTTP overhead for no cache
          // benefit (nothing else here is anywhere near react/tiptap in size).
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
              return 'react-vendor';
            }
            if (/node_modules\/@tiptap\//.test(id)) {
              return 'editor-vendor';
            }
            if (/node_modules\/@radix-ui\//.test(id)) {
              return 'radix-vendor';
            }
            return 'vendor';
          },
        },
      },
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
