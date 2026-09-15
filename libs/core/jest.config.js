const {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
} = require('../../jest.esm-deps.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../../../apps/worker/test/openlinker.sequencer.cjs',
  // Self-hosted CI runner (added via 444244f) runs libs/core jest in
  // parallel with apps/web vitest and libs/shared jest. Jest's default
  // (CPU-count-minus-one workers) oversubscribes memory and triggers
  // kernel OOM kills on worker processes, aborting random test suites.
  // Capped to 2 off CI — this file is also reached by `.husky/pre-commit`
  // -> `pnpm smart-test`, which falls back to a bare `pnpm test` on a
  // contributor's own machine. Under CI the cap is 8 (#3271): the runner is a
  // 64-core / 251 GB box where `cores-1` would be 63, and the whole job's
  // measured peak RSS at 8 workers was 32.4 GB.
  maxWorkers: process.env.CI ? 8 : 2,
  // Added with that raise (#3271): this package had no idle-memory ceiling at
  // all, and it is the heaviest per worker in the repo (~2.8 GB peak). Jest
  // recycles a worker once its heap crosses the limit, before the OS does it
  // with a SIGKILL that reads like a test failure.
  workerIdleMemoryLimit: '512MB',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
            baseUrl: '../../',
            paths: {
                '@openlinker/core/*': ['libs/core/src/*'],
                '@openlinker/shared/*': ['libs/shared/src/*'],
              },
        }
      },
    ],
    // ESM-only htmlparser2 chain pulled in transitively by sanitize-html
    // >=2.17.6 via @openlinker/shared/html — see jest.esm-deps.cjs.
    '^.+\\.js$': esmDepsJsTransform,
  },
  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@openlinker/core/(.*)$': '<rootDir>/$1',
    '^@openlinker/shared$': '<rootDir>/../../../libs/shared/src/index.ts',
    '^@openlinker/shared/(.*)$': '<rootDir>/../../../libs/shared/src/$1',
  },
};
