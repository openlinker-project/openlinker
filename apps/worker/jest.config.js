const path = require('path');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../test/openlinker.sequencer.cjs',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  moduleNameMapper: {
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../libs/core/src/$1'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../libs/shared/src/$1'),
    '^@openlinker/integrations-prestashop/(.*)$': path.resolve(__dirname, '../../libs/integrations/prestashop/src/$1'),
    '^@openlinker/integrations-allegro$': path.resolve(__dirname, '../../libs/integrations/allegro/src/index.ts'),
    '^@openlinker/integrations-allegro/(.*)$': path.resolve(__dirname, '../../libs/integrations/allegro/src/$1'),
  },
};

