import { ciStabilityConfig } from '../../../jest.ci-stability.mjs';

export default {
  testEnvironment: 'node',
  rootDir: '.',
  testSequencer: '<rootDir>/test/openlinker.sequencer.cjs',

  // IMPORTANT: avoid running fixtures/mocks as "tests"
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
  },

  // Helps when TS/Node16 emits/assumes .js in import paths
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@openlinker/integrations-erli$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-erli/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
    // plugin-sdk → src. The current spec only type-imports from the SDK (erased
    // by ts-jest), so this is defensive: it resolves the value import made via
    // erli-integration.module.ts (createNestAdapterModule) the moment a future
    // spec touches the module. Matches the other createNestAdapterModule plugins.
    '^@openlinker/plugin-sdk$': '<rootDir>/../../plugin-sdk/src/index.ts',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,

  // CI stability (#976): same worker/memory caps as the other integration
  // packages so the cross-package full-suite fan-out can't OOM-kill a worker.
  // See jest.ci-stability.mjs at the repo root.
  ...ciStabilityConfig,
};
