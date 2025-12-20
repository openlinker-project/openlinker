const baseConfig = require('../../.eslintrc.js');

module.exports = {
  ...baseConfig,
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  root: false,
};
