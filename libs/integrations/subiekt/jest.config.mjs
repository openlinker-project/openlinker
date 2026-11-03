import { createRequire } from 'node:module';

import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '../../../jest.esm-deps.cjs';

const { resolveUnitTestWorkers } = createRequire(import.meta.url)('../../../jest.unit-workers.cjs');

export default {
  testEnvironment: 'node',
  rootDir: '.',

  // IMPORTANT: avoid running fixtures/contract-suite helpers as "tests"
  testMatch: ['<rootDir>/src/**/*.spec.ts'],

  // ESM + TS support for Node16 module resolution
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
    // ESM-only htmlparser2 chain pulled in transitively by sanitize-html
    // >=2.17.6 via @openlinker/shared/html — see jest.esm-deps.cjs.
    '^.+\\.js$': esmDepsJsTransform,
  },

  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],

  // Helps when TS/Node16 emits/assumes .js in import paths
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@openlinker/integrations-subiekt$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-subiekt/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
    '^@openlinker/plugin-sdk$': '<rootDir>/../../plugin-sdk/src/index.ts',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,

  // CI stability (#3918): without a cap jest spawns ~(cores-1) workers, and
  // inside the CI container it counts the HOST's cores, not the 8 it may use.
  // With this package running beside others under --workspace-concurrency, the
  // uncapped packages OOM-killed jest workers (SIGKILL) in other packages.
  maxWorkers: resolveUnitTestWorkers(),
  workerIdleMemoryLimit: '512MB',
};
