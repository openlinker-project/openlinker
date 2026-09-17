const path = require('path');
const {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
} = require('../../../jest.esm-deps.cjs');
const { resolveTestWorkers } = require('../../../jest.test-workers.cjs');

module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    // Transpile-only, and it is the single biggest lever on this tier (#3263).
    //
    // ts-jest's default builds a TypeScript program and type-checks it, and Jest
    // resets the module registry per FILE - so that work happened 187 times per
    // run. Measured on an EMPTY spec (no imports, one `expect(1).toBe(1)`, a
    // minimal config with no containers and no setup files): 11.9 s with the
    // default, 0.5 s transpile-only. That floor, not the tests, was the tier.
    //
    // Measured A/B on the full 190-file suite, same machine, 8 workers:
    // 620 s wall / 4793 s summed-suite against 198 s / 742 s - 3.1x on the
    // clock, 6.5x on the work. Both runs lost suites to container flakiness on
    // a loaded box (3 against 1); nothing failed to COMPILE under isolation,
    // which is what this option risks.
    //
    // `diagnostics: false` alone is NOT the lever and was measured separately:
    // it silences errors while still building the program, and its own run came
    // back SLOWER. `isolatedModules` is what switches ts-jest to
    // `ts.transpileModule`.
    //
    // The cost is real and is paid elsewhere: test files lose type-checking
    // here, and `tsconfig.type-check.json` excludes `test`, so they had no
    // other checker. `tsconfig.test-check.json` + the Type Check job's second
    // step is where that coverage now lives - it runs in parallel, so it costs
    // nothing on the clock.
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, diagnostics: false }],
    // ESM-only htmlparser2 chain pulled in transitively by sanitize-html
    // >=2.17.6 via @openlinker/shared/html — see jest.esm-deps.cjs.
    '^.+\\.js$': esmDepsJsTransform,
  },
  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
  // Explicit, in-workspace transform cache so CI can persist it between
  // runs. A cold cache costs the run's FIRST suite ~32 s on CI (measured:
  // 6.4 s warm vs 76.3 s cold locally for the same file) because every
  // int-spec pulls the whole AppModule graph through ts-jest (#1920).
  cacheDirectory: path.resolve(__dirname, '../../../.jest-cache/worker-integration'),
  // Every worker owns its own Postgres database and Redis logical DB (see
  // `libs/test-kit/src/containers.ts`), which is what makes a count above 1
  // safe: before that, a second worker's `TRUNCATE ... CASCADE` + `flushDb()`
  // reset would wipe a peer's data mid-test. Resolved from
  // `OL_TEST_MAX_WORKERS`, defaulting to `DEFAULT_TEST_WORKERS` (6, not
  // gated on `CI` - unlike the unit tier, this only runs against Docker on a
  // machine that already opted in). A local run with no env set therefore
  // gets 6 workers too; `OL_TEST_MAX_WORKERS=1` is the escape hatch back to
  // the old serial behaviour, for bisecting a parallelism-sensitive failure.
  // See `jest.test-workers.cjs`.
  maxWorkers: resolveTestWorkers(),
  // Nothing in this repo caps a worker's heap, so a worker that grows runs
  // until the kernel OOM-killer takes it - and the symptom ("Jest worker
  // process crashed") reads like a broken test. Jest restarts a worker that
  // passes this between files instead.
  workerIdleMemoryLimit: '1GB',
  testTimeout: 120000,
  // Mirrors apps/api: the worker AppModule boots long-lived handles (scheduler
  // crons, JobIntake consumption loops) that onModuleDestroy stops but may not
  // fully drain; forceExit is the safety net against a CI hang after tests pass.
  forceExit: true,
  // Start/stop the Postgres + Redis Testcontainers once for the whole run and
  // export their connection env BEFORE any suite boots AppModule. Without these
  // the harness never runs, so AppModule falls back to localhost defaults —
  // green locally (dev stack on :5432/:6379) but ECONNREFUSED in CI (#786).
  globalSetup: '<rootDir>/test/integration/setup-global.ts',
  globalTeardown: '<rootDir>/test/integration/teardown.ts',
  // Point each worker process at its own database and Redis logical DB before
  // anything can read the env globalSetup wrote (#3263). `setupFiles` rather
  // than `setupFilesAfterEnv`: this must land before the spec module graph is
  // evaluated, and `setup-each.ts` already imports `./setup` at module load.
  setupFiles: ['<rootDir>/test/integration/setup-worker-scope.ts'],
  // Reset the shared harness around EVERY test case of EVERY int-spec, so a
  // spec is isolated by omission rather than by its author remembering to
  // call resetTestHarness(). 21 of the 27 specs here reset in `afterEach`
  // only and six reset nowhere, which left a file's first assertion reading
  // whatever the previous file happened to leave behind. The audit of what a
  // reset (including its `flushDb()`) is safe to do between every test case,
  // and why, lives in setup-each.ts.
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup-each.ts'],
  moduleNameMapper: {
    '^@openlinker/core$': path.resolve(__dirname, '../../../libs/core/src/index.ts'),
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
    '^@openlinker/plugin-sdk$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/index.ts'),
    '^@openlinker/plugin-sdk/(.*)$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/$1'),
    '^@openlinker/oms$': path.resolve(__dirname, '../../../libs/oms/src/index.ts'),
    '^@openlinker/oms/(.*)$': path.resolve(__dirname, '../../../libs/oms/src/$1'),
    '^@openlinker/test-kit$': path.resolve(__dirname, '../../../libs/test-kit/src/index.ts'),
    '^@openlinker/test-kit/(.*)$': path.resolve(__dirname, '../../../libs/test-kit/src/$1'),
    '^@openlinker/integrations-allegro$': path.resolve(
      __dirname,
      '../../../libs/integrations/allegro/src/index.ts',
    ),
    '^@openlinker/integrations-allegro/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/allegro/src/$1',
    ),
    '^@openlinker/integrations-prestashop$': path.resolve(
      __dirname,
      '../../../libs/integrations/prestashop/src/index.ts',
    ),
    '^@openlinker/integrations-prestashop/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/prestashop/src/$1',
    ),
    '^@openlinker/integrations-ai$': path.resolve(
      __dirname,
      '../../../libs/integrations/ai/src/index.ts',
    ),
    '^@openlinker/integrations-ai/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/ai/src/$1',
    ),
    '^@openlinker/integrations-woocommerce$': path.resolve(
      __dirname,
      '../../../libs/integrations/woocommerce/src/index.ts',
    ),
    '^@openlinker/integrations-woocommerce/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/woocommerce/src/$1',
    ),
    '^@openlinker/integrations-subiekt$': path.resolve(
      __dirname,
      '../../../libs/integrations/subiekt/src/index.ts',
    ),
    '^@openlinker/integrations-subiekt/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/subiekt/src/$1',
    ),
    '^@openlinker/integrations-fx$': path.resolve(
      __dirname,
      '../../../libs/integrations/fx/src/index.ts',
    ),
    '^@openlinker/integrations-fx/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/fx/src/$1',
    ),
    '^@openlinker/integrations-erli$': path.resolve(
      __dirname,
      '../../../libs/integrations/erli/src/index.ts',
    ),
    '^@openlinker/integrations-erli/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/erli/src/$1',
    ),
    '^@openlinker/integrations-ksef$': path.resolve(
      __dirname,
      '../../../libs/integrations/ksef/src/index.ts',
    ),
    '^@openlinker/integrations-ksef/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/ksef/src/$1',
    ),
    '^@openlinker/integrations-inpost$': path.resolve(
      __dirname,
      '../../../libs/integrations/inpost/src/index.ts',
    ),
    '^@openlinker/integrations-inpost/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/inpost/src/$1',
    ),
    '^@openlinker/integrations-dpd-polska$': path.resolve(
      __dirname,
      '../../../libs/integrations/dpd-polska/src/index.ts',
    ),
    '^@openlinker/integrations-dpd-polska/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/dpd-polska/src/$1',
    ),
    '^@openlinker/integrations-infakt$': path.resolve(
      __dirname,
      '../../../libs/integrations/infakt/src/index.ts',
    ),
    '^@openlinker/integrations-infakt/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/infakt/src/$1',
    ),
    '^@openlinker/integrations-eparagony$': path.resolve(
      __dirname,
      '../../../libs/integrations/eparagony/src/index.ts',
    ),
    '^@openlinker/integrations-eparagony/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/eparagony/src/$1',
    ),
  },
};
