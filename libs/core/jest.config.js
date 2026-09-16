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
  // The cap stays 2 (#3271). It was raised to 8 under CI against a lab
  // measurement taken on an IDLE runner, and reverted after measuring the real
  // job: 8 workers here starve whatever package runs beside it under
  // `--workspace-concurrency=2`, and this package's own gain was only 73.0 s ->
  // 64.5 s while `apps/api` went 80.0 s -> 163.0 s and one of its workers was
  // OOM-killed. A lab number from an idle box is not a CI number: the real
  // runner shares the machine with seven other concurrent jobs.
  //
  // Deliberately NO `workerIdleMemoryLimit` here either. A '512MB' ceiling was
  // tried and reverted: this package's workers legitimately peak around 2.8 GB,
  // so the limit recycled a worker after almost every file, re-spawning the
  // process and rebuilding the whole module graph each time. On the real runner
  // that took the package from 74 s to over 17 minutes. If a ceiling is ever
  // wanted here, size it above the package's real working set, not by copying
  // prestashop's number.
  // Stays 2 (#3271). Raised to 8 TWICE and reverted twice - first against a lab
  // measurement from an idle runner, then again after `apps/web` moved to its
  // own CI job, on the reasoning that four backend packages at 2 workers only
  // put eight of the host's cores to work. Both times the real job got
  // materially slower; the second attempt was past 13 minutes against a 4m21s
  // baseline when it was killed.
  //
  // So the fan-out is NOT the limit here, and the free-core arithmetic is
  // wrong: the runners are four containers on ONE host, sharing it with every
  // other job of the same workflow - Integration Tests above all. Cores that
  // look idle from inside one container are not idle.
  //
  // Do not raise this a third time without first measuring what the HOST is
  // doing, not what the container can see.
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
