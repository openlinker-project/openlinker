import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '../../jest.esm-deps.cjs';

export default {
  testEnvironment: 'node',
  rootDir: '.',

  testMatch: ['<rootDir>/src/**/*.spec.ts'],

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
    '^@openlinker/plugin-sdk$': '<rootDir>/src/index.ts',
    '^@openlinker/plugin-sdk/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/index.ts'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,
};
