const baseConfig = require('../../.eslintrc.js');

module.exports = {
  ...baseConfig,
  root: false,
  rules: {
    ...baseConfig.rules,
    '@typescript-eslint/unbound-method': 'off',
  },
};
