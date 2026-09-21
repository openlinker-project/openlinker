import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '../../../jest.esm-deps.cjs';

export default {
  testEnvironment: 'node',
  rootDir: '.',

  // Avoid running fixtures/mocks as "tests"
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

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@openlinker/integrations-eparagony$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-eparagony/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
    // Required: eparagony-plugin.ts imports dispatchCapability and
    // eparagony-integration.module.ts imports createNestAdapterModule.
    '^@openlinker/plugin-sdk$': '<rootDir>/../../plugin-sdk/src/index.ts',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,
};
