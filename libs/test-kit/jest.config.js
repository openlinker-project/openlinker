const { resolveUnitTestWorkers } = require('../../jest.unit-workers.cjs');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  passWithNoTests: true,

  // CI stability (#3918): without a cap jest spawns ~(cores-1) workers, and
  // inside the CI container it counts the HOST's cores, not the 8 it may use.
  // With this package running beside others under --workspace-concurrency, the
  // uncapped packages OOM-killed jest workers (SIGKILL) in other packages.
  maxWorkers: resolveUnitTestWorkers(),
  workerIdleMemoryLimit: '512MB',
};
