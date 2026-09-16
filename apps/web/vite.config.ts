import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { createOgMetaPlugin } from './src/build-time/og-meta';

// Anchored on the config file itself, not `process.cwd()`: the build is
// invoked both from the package dir (`pnpm --filter`) and from the repo root,
// and only one of those makes a cwd-relative env lookup find `.env*`.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

// The unit-tier worker count, from the one resolver at the repo root (#3271),
// so this package cannot drift from the five jest packages beside it. Required
// rather than imported: it is CJS, and this file is ESM TypeScript.
const { resolveUnitTestWorkers } = createRequire(import.meta.url)(
  '../../jest.unit-workers.cjs',
) as { resolveUnitTestWorkers: () => number };

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
    test: {
      environment: 'happy-dom',
      // Self-hosted CI runner (added 2026-04 via 444244f) is materially slower
      // than ubuntu-latest; RTL tests with multiple async state transitions
      // (wizards, dialogs + API calls, nested queries) can exceed the 5000ms
      // vitest default. Local runs complete in 2–3s per test; CI stretches
      // each transform/import pass by ~20×. Bumping to 10s keeps hangs
      // failing visibly while accommodating the runner.
      //
      // Raised again to 20s (#3271) for a second, additive reason: this package
      // no longer has the box to itself. `pnpm -r --no-sort
      // --workspace-concurrency=4` means three other packages run alongside it,
      // and a loaded runner stretched it from 163s to 371s in one measured run,
      // so the headroom a single-tenant 10s bought is not the headroom a
      // four-tenant one needs. 20s still fails a genuine hang quickly - nothing
      // here legitimately takes ten seconds - it just stops CPU contention
      // reading as a product defect.
      testTimeout: 20000,
      teardownTimeout: 10000,
      // Bound vitest's own pool (#3271), at the same count as every jest
      // package in the unit tier - see `jest.unit-workers.cjs`.
      //
      // Vitest defaults maxForks to `cores - 1`, which here is 63, and that
      // number is the trap rather than the fix: `os.cpus()` reports the HOST's
      // 64 cores, while the CI job runs inside a container whose cgroup allows
      // it about 8 CPUs of quota (#3263 measured that container at 800% of its
      // 800%). So the default does not spawn 63 workers across 63 cores, it
      // spawns 63 processes to contend over 8 - and the run's own profile bears
      // that out: ~1070 cpu-seconds finishing in ~163 s wall is an effective
      // parallelism of about 6.6, so the extra forks were never doing anything.
      //
      // The CI gate stays at the call site rather than moving into the
      // resolver, because off CI this package deliberately keeps vitest's own
      // default: a contributor's laptop really does have few enough cores that
      // `cores - 1` is the right number there, and the jest packages' local 2
      // exists for a different reason (`.husky/pre-commit` runs them, it does
      // not run this).
      //
      // `maxWorkers` is top-level: vitest 4 removed `poolOptions`, and the old
      // nesting is accepted-and-ignored with only a DEPRECATED line in the
      // output, so writing it that way caps nothing while looking like it does.
      ...(process.env.CI ? { maxWorkers: resolveUnitTestWorkers() } : {}),
      setupFiles: './src/test/setup.ts',
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
      },
    },
  };
});
