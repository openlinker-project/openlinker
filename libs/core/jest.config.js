const {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
} = require('../../jest.esm-deps.cjs');

const { resolveUnitTestWorkers } = require('../../jest.unit-workers.cjs');

const { transpileOnlyTsJest } = require('../../jest.ts-transform.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../../../apps/worker/test/openlinker.sequencer.cjs',
  // Worker count comes from the one resolver at the repo root (#3271), so
  // every unit package declares the same cap and a change lands in one place.
  // See `jest.unit-workers.cjs` for the number and the measurement behind it;
  // the short version is that the CI container is capped at 8 CPUs and 24 GiB
  // regardless of the 64-core host it sits on.
  //
  // The history of this value is worth keeping, because it was got wrong three
  // times on this branch. It was raised to 8 twice and reverted twice - the job
  // got slower, and the second time the runner died. Both raises ran alongside
  // `--workspace-concurrency=4`, i.e. four packages at eight workers: 32 jest
  // processes on a container with 8 CPUs. Measured on the real job:
  //
  //   2 workers   4m07s, 4m21s
  //   4 workers   4m48s
  //   8 workers   13m01s, 17m12s, 18m45s (one runner died)
  //
  // The lab on the host said 4 workers was 12% FASTER than 2, which is exactly
  // the trap: the lab sees the host's 64 cores, the job sees 8.
  maxWorkers: resolveUnitTestWorkers(),
  // Recycle a worker once its heap passes this, so a long-lived worker cannot
  // drift into GC thrashing (#3271). Measured on the runner host, interleaved
  // over two rounds against an otherwise identical config: 91 s / 92 s with it,
  // 100 s / 106 s without, all 14 214 tests passing either way.
  //
  // The SIZE is the whole point and the reason an earlier attempt failed. A
  // '512MB' ceiling was tried and reverted because this package's workers
  // legitimately peak near 2.8 GB, so it recycled a worker after almost every
  // file and rebuilt the module graph each time - 74 s became over 17 minutes.
  // A ceiling must sit ABOVE the package's real working set; it exists to catch
  // unbounded growth, not to cap normal use.
  workerIdleMemoryLimit: '3GB',
  transform: {
    '^.+\\.ts$': transpileOnlyTsJest({
      tsconfig: {
        baseUrl: '../../',
        paths: {
          '@openlinker/core/*': ['libs/core/src/*'],
          '@openlinker/shared/*': ['libs/shared/src/*'],
        },
      },
    }),
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
