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
  // Capping to 2 workers keeps memory headroom without materially
  // affecting wall time on reasonable hosts.
  maxWorkers: 2,
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
