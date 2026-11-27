const { resolveUnitTestWorkers } = require('../../jest.unit-workers.cjs');

const {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
} = require('../../jest.esm-deps.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../test/openlinker.sequencer.cjs',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': esmDepsJsTransform,
  },
  // htmlparser2 (pulled in by sanitize-html >=2.17.6) and its own dependency
  // chain (domutils, domhandler, domelementtype, entities) ship ESM-only —
  // see docs/lessons.md and src/html/sanitize-stored-html.ts, and
  // jest.esm-deps.cjs for why this must be mirrored in every jest config
  // that can reach @openlinker/shared/html.
  transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@openlinker/shared/(.*)$': '<rootDir>/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../libs/core/src/$1',
  },
  passWithNoTests: true,

  // CI stability (#3918): without a cap jest spawns ~(cores-1) workers, and
  // inside the CI container it counts the HOST's cores, not the 8 it may use.
  // With this package running beside others under --workspace-concurrency, the
  // uncapped packages OOM-killed jest workers (SIGKILL) in other packages.
  maxWorkers: resolveUnitTestWorkers(),
  workerIdleMemoryLimit: '512MB',
};
