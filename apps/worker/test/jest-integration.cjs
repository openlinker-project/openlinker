const path = require('path');

module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  maxWorkers: 1,
  testTimeout: 120000,
  moduleNameMapper: {
    '^@openlinker/core$': path.resolve(__dirname, '../../../libs/core/src/index.ts'),
    '^@openlinker/core/(.*)$': path.resolve(__dirname, '../../../libs/core/src/$1'),
    '^@openlinker/shared$': path.resolve(__dirname, '../../../libs/shared/src/index.ts'),
    '^@openlinker/shared/(.*)$': path.resolve(__dirname, '../../../libs/shared/src/$1'),
    '^@openlinker/integrations-allegro$': path.resolve(
      __dirname,
      '../../../libs/integrations/allegro/src/index.ts',
    ),
    '^@openlinker/integrations-allegro/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/allegro/src/$1',
    ),
    '^@openlinker/integrations-prestashop$': path.resolve(
      __dirname,
      '../../../libs/integrations/prestashop/src/index.ts',
    ),
    '^@openlinker/integrations-prestashop/(.*)$': path.resolve(
      __dirname,
      '../../../libs/integrations/prestashop/src/$1',
    ),
  },
};
