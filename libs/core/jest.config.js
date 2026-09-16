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
  // 8 under CI, and this value's history is the whole lesson (#3271).
  //
  // It was raised to 8 twice and reverted twice, both times because the job got
  // slower and the second time because the runner DIED. Both of those raises
  // came with `--workspace-concurrency=4`, so they meant four packages at eight
  // workers: 32 jest processes, on a host that is not the container's to spend.
  // `bd-build-server` carries all four runner containers plus everything else,
  // and sits at load 27-41 with ~91 GB used before CI adds anything.
  //
  // Measured on that host, this package alone, back to back: 70 s at 2 workers,
  // 26 s at 8, 50 s at 2 again as a drift control. `apps/api` the same way:
  // 47 s / 21 s / 45 s. So a package really does scale with workers - the count
  // per package was never the problem, the PRODUCT was.
  //
  // That per-package reading was still misleading, and the correction is the
  // useful part. Measured with the WHOLE backend command instead of one
  // package, on the same host, interleaved over two rounds so a drifting load
  // hits every candidate equally:
  //
  //   concurrency 4 x 2 workers   90 s, 97 s
  //   concurrency 4 x 4 workers   82 s, 83 s   <- consistent winner
  //   concurrency 3 x 8 workers   88 s, 91 s
  //
  // And the host has a blind spot that matters: that 3 x 8 row looks fine and
  // took 17m12s on real CI, because the lab run has no `Test (web)` at 8
  // workers, no Integration Tests and no Lint beside it. The lab UNDERSTATES
  // what a high worker count costs.
  //
  // So the lab's winner was tried on CI too, and lost. Every raise has now been
  // measured against the real job, and the answer is monotonic:
  //
  //   2 workers   4m07s, 4m21s
  //   4 workers   4m48s          <- the lab said this was 12% FASTER
  //   8 workers   13m01s, 17m12s, 18m45s (one runner died)
  //
  // The value is 2 and the question is closed. The lab is useful for
  // correctness questions and useless for this one, because the load it cannot
  // see is the whole effect.
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
