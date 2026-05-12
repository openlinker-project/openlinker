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
  },

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
