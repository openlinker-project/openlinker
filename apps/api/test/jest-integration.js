const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: path.resolve(__dirname, '..'), // apps/api
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],

  // Only transform .ts files to avoid allowJs warnings and unnecessary processing
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
        // ✅ Use tsconfig option (not compilerOptions) - this is the correct ts-jest API
        // ✅ Use CommonJS + node resolution for Jest runtime (Jest runs in CommonJS mode)
        // This prevents TS5110 error and aligns with Jest's CommonJS execution environment
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

  // Keep setupFilesAfterEnv for per-test-file setup (getTestHarness)
  // and globalTeardown for cleanup after all tests
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup.ts'],
  globalTeardown: '<rootDir>/test/integration/teardown.ts',

  testTimeout: 60000,
  maxWorkers: 1, // Ensure tests run serially for database isolation

  moduleNameMapper: {
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
  },

  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: '../coverage-integration',
  coveragePathIgnorePatterns: ['/node_modules/', '/test/', '\\.spec\\.ts$', '\\.int-spec\\.ts$'],

  clearMocks: true,
  restoreMocks: true,
};

