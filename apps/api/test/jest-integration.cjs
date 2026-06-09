const path = require('path');

module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  maxWorkers: 1,
  testTimeout: 120000,
  // Prevent CI hangs caused by long-lived timers (e.g. SchedulerService CronJobs)
  // that are not fully drained even after app.close(). onModuleDestroy stops them,
  // but forceExit is a safety net for any other handles left open by NestJS internals.
  forceExit: true,
  moduleNameMapper: {
    '^@openlinker/core$': path.resolve(__dirname, '../../../libs/core/src/index.ts'),
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
    '^@openlinker/plugin-sdk$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/index.ts'),
    '^@openlinker/plugin-sdk/(.*)$': path.resolve(__dirname, '../../../libs/plugin-sdk/src/$1'),
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
    '^@openlinker/integrations-dpd-polska$': path.resolve(
      __dirname,
      '../../../libs/integrations/dpd-polska/src/index.ts',
    ),
    '^@openlinker/integrations-dpd-polska/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/dpd-polska/src/$1',
    ),
    '^@openlinker/integrations-woocommerce$': path.resolve(
      __dirname,
      '../../../libs/integrations/woocommerce/src/index.ts',
    ),
    '^@openlinker/integrations-woocommerce/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/woocommerce/src/$1',
    ),
    '^@openlinker/test-kit$': path.resolve(__dirname, '../../../libs/test-kit/src/index.ts'),
    '^@openlinker/test-kit/(.*)$': path.resolve(__dirname, '../../../libs/test-kit/src/$1'),
  },
};
