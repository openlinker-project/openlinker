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
  // 8 under CI, 2 off it (#3271) - and this value has been 2, then 8, then 2,
  // then 8 again, so the history is worth having in one place.
  //
  // The first raise was justified by a lab run on an IDLE runner and reverted:
  // in the real job it starved the package running beside it and took
  // `apps/api` from 80.0 s to 163.0 s with an OOM SIGKILL. What changed since
  // is the arrangement, not the arithmetic. `apps/web` now has its own CI job
  // rather than a share of this one, and `--no-sort` means the four heavy
  // backend packages run together - at 2 workers each that is eight workers,
  // and this package became the job's long pole at 140.9 s.
  //
  // So the raise is re-applied against the arrangement it was wrong for
  // before. If it regresses again, revert THIS value rather than reaching for
  // an idle-box measurement to defend it.
  //
  // Deliberately NO `workerIdleMemoryLimit` here either. A '512MB' ceiling was
  // tried and reverted: this package's workers legitimately peak around 2.8 GB,
  // so the limit recycled a worker after almost every file, re-spawning the
  // process and rebuilding the whole module graph each time. On the real runner
  // that took the package from 74 s to over 17 minutes. If a ceiling is ever
  // wanted here, size it above the package's real working set, not by copying
  // prestashop's number.
  maxWorkers: process.env.CI ? 8 : 2,
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
