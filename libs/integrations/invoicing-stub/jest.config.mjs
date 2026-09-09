import { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } from '../../../jest.esm-deps.cjs';

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
    '^.+\\.js$': esmDepsJsTransform,
  },

  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@openlinker/integrations-invoicing-stub$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-invoicing-stub/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
    '^@openlinker/plugin-sdk$': '<rootDir>/../../plugin-sdk/src/index.ts',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,
};
