const path = require('path');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../test/openlinker.sequencer.cjs',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  forceExit: true,
  // Self-hosted CI (added via 444244f) runs this package's jest in
  // parallel with libs/core, libs/shared, libs/integrations/*, apps/web,
  // and apps/worker. Default worker count oversubscribes CPU/memory:
  // bcrypt-heavy auth tests starve each other and trip the 5s timeout,
  // and random workers get OOM-killed (SIGKILL). Cap workers and raise
  // timeout to match the other packages.
  maxWorkers: 2,
  testTimeout: 10000,
  moduleNameMapper: {
    '^@openlinker/integrations-allegro$': path.resolve(__dirname, '../../libs/integrations/allegro/src/index.ts'),
    '^@openlinker/integrations-allegro/(.*)$': path.resolve(__dirname, '../../libs/integrations/allegro/src/$1'),
    '^@openlinker/integrations-ai$': path.resolve(__dirname, '../../libs/integrations/ai/src/index.ts'),
    '^@openlinker/integrations-ai/(.*)$': path.resolve(__dirname, '../../libs/integrations/ai/src/$1'),
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../libs/shared/src/$1'),
  },
};




