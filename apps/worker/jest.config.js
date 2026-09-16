const path = require('path');
const { ESM_DEPS_TRANSFORM_IGNORE_PATTERN, esmDepsJsTransform } = require('../../jest.esm-deps.cjs');

const { resolveUnitTestWorkers } = require('../../jest.unit-workers.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../test/openlinker.sequencer.cjs',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
    // ESM-only htmlparser2 chain pulled in transitively by sanitize-html
    // >=2.17.6 via @openlinker/shared/html — see jest.esm-deps.cjs.
    '^.+\\.js$': esmDepsJsTransform,
  },
  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  // Worker count comes from the one resolver at the repo root (#3271).
  // See `jest.unit-workers.cjs`, and `libs/core/jest.config.js` for the full
  // history of the number. Measured here during the reverted 8-worker attempt:
  // 93.2 s -> 142.9 s.
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
  testTimeout: 10000,
  moduleNameMapper: {
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../libs/shared/src/$1'),
    '^@openlinker/integrations-prestashop/(.*)$': path.resolve(__dirname, '../../libs/integrations/prestashop/src/$1'),
    '^@openlinker/integrations-allegro$': path.resolve(__dirname, '../../libs/integrations/allegro/src/index.ts'),
    '^@openlinker/integrations-allegro/(.*)$': path.resolve(__dirname, '../../libs/integrations/allegro/src/$1'),
  },
};

