const path = require('path');
const {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
} = require('../../../jest.esm-deps.cjs');

module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // ESM-only htmlparser2 chain pulled in transitively by sanitize-html
    // >=2.17.6 via @openlinker/shared/html — see jest.esm-deps.cjs.
    '^.+\\.js$': esmDepsJsTransform,
  },
  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
  // Explicit, in-workspace transform cache so CI can persist it between
  // runs. A cold cache costs the run's FIRST suite ~32 s on CI (measured:
  // 6.4 s warm vs 76.3 s cold locally for the same file) because every
  // int-spec pulls the whole AppModule graph through ts-jest (#1920).
  cacheDirectory: path.resolve(__dirname, '../../../.jest-cache/api-integration'),
  maxWorkers: 1,
  testTimeout: 120000,
  // Prevent CI hangs caused by long-lived timers (e.g. SchedulerService CronJobs)
  // that are not fully drained even after app.close(). onModuleDestroy stops them,
  // but forceExit is a safety net for any other handles left open by NestJS internals.
  forceExit: true,
  // Start the Postgres + Redis Testcontainers in the main-process realm
  // BEFORE any worker boots an int-spec (mirrors apps/worker). Required so
  // globalTeardown below can actually stop what was started — a container
  // booted lazily from inside a worker-realm int-spec's getTestHarness()
  // call would be invisible to globalTeardown, which runs in a different
  // realm with its own `globalThis` (#1285).
  globalSetup: '<rootDir>/test/integration/setup-global.ts',
  // Stop the Postgres + Redis Testcontainers started by globalSetup above
  // once this whole run finishes. See teardown.ts and
  // libs/test-kit/src/harness.ts's `IntegrationTestHarnessImpl.teardown()`
  // comment, which explicitly relies on this global hook to do it (#1285).
  globalTeardown: '<rootDir>/test/integration/teardown.ts',
  moduleNameMapper: {
    '^@openlinker/api/(.*)$': path.resolve(__dirname, '../src/$1'),
    '^@openlinker/core$': path.resolve(__dirname, '../../../libs/core/src/index.ts'),
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
    '^@openlinker/plugin-sdk$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/index.ts'),
    '^@openlinker/plugin-sdk/(.*)$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/$1'),
    '^@openlinker/oms$': path.resolve(__dirname, '../../../libs/oms/src/index.ts'),
    '^@openlinker/oms/(.*)$': path.resolve(__dirname, '../../../libs/oms/src/$1'),
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
    '^@openlinker/integrations-inpost$': path.resolve(
      __dirname,
      '../../../libs/integrations/inpost/src/index.ts',
    ),
    '^@openlinker/integrations-inpost/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/inpost/src/$1',
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
    '^@openlinker/test-kit$': path.resolve(__dirname, '../../../libs/test-kit/src/index.ts'),
    '^@openlinker/test-kit/(.*)$': path.resolve(__dirname, '../../../libs/test-kit/src/$1'),
  },
};
