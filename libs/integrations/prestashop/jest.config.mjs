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
    '^@openlinker/integrations-prestashop$': '<rootDir>/src/index.ts',
    '^@openlinker/integrations-prestashop/(.*)$': '<rootDir>/src/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
  },

  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  testTimeout: 30000,

  // CI stability (#976): the full-suite `pnpm -r test` fan-out runs every
  // package's Jest concurrently; this heavy package's default ~(cores-1)
  // workers contributed to OS OOM-kills (SIGKILL/exitCode=null) on the
  // self-hosted runner. A hard worker cap (absolute, not '50%', so it's
  // deterministic regardless of runner core count) plus a per-worker memory
  // ceiling (recycle the worker before the OS does) bound peak memory.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};

