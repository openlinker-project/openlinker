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
    '^@openlinker/integrations-ai$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-ai/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,
};
