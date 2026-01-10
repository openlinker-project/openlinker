module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules', 'coverage', '**/*.d.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Discourage deep relative imports - prefer path aliases for cross-layer/cross-package imports
    // Note: Infrastructure/persistence layers use relative imports to avoid runtime ERR_PACKAGE_PATH_NOT_EXPORTED errors
    // These warnings are acceptable for now - consider path aliases when refactoring
    'no-restricted-imports': [
      'warn',
      {
        patterns: [
          {
            group: ['../../domain/*', '../../infrastructure/*', '../../../domain/*', '../../../infrastructure/*'],
            message: 'Use path aliases (@openlinker/*) for cross-layer imports instead of deep relative paths. Exception: infrastructure/persistence layers may use relative imports to avoid runtime errors.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.test.ts'],
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        // Allow unsafe arguments in toThrow() calls - Jest's type definitions are strict
        // Exception classes extending Error should be valid, but TypeScript infers them as 'any'
        '@typescript-eslint/no-unsafe-argument': 'off',
        // Allow unsafe assignments in test files - Jest matchers like expect.objectContaining() return 'any'
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
    {
      // Infrastructure/persistence layers use relative imports to avoid runtime ERR_PACKAGE_PATH_NOT_EXPORTED errors
      // These are intentional and necessary for proper module resolution at runtime
      files: [
        '**/infrastructure/**/*.ts',
        '**/persistence/**/*.ts',
        '**/application/**/*.ts', // Application layer also uses relative imports for domain
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};

