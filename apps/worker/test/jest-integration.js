const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: path.resolve(__dirname, '..'), // apps/worker (worker package root)
  
  // Use local sequencer to avoid pnpm module resolution issues with @jest/test-sequencer
  // This removes the need to resolve @jest/test-sequencer entirely
  testSequencer: '<rootDir>/test/openlinker.sequencer.cjs',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],

  // Only transform .ts files to avoid allowJs warnings and unnecessary processing
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@testcontainers|@openlinker)/)',
  ],

  // Global setup/teardown: manage containers only (no Nest imports)
  globalSetup: '<rootDir>/test/integration/setup-global.ts',
  globalTeardown: '<rootDir>/test/integration/teardown.ts',
  
  // Per-test-file setup: boot Nest app context and get test harness
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup.ts'],

  testTimeout: 60000,
  maxWorkers: 1, // Ensure tests run serially for database isolation

  moduleNameMapper: {
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
    '^@openlinker/integrations-prestashop/(.*)$': path.resolve(__dirname, '../../../libs/integrations/prestashop/src/$1'),
    '^@openlinker/api/(.*)$': path.resolve(__dirname, '../../api/src/$1'),
  },

  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: '../coverage-integration',
  coveragePathIgnorePatterns: ['/node_modules/', '/test/', '\\.spec\\.ts$', '\\.int-spec\\.ts$'],

  clearMocks: true,
  restoreMocks: true,
};

