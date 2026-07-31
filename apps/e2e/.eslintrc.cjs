/**
 * ESLint config for @openlinker/e2e (self-contained).
 *
 * `root: true` so this package is linted against its OWN tsconfig (Bundler
 * module resolution) rather than the repo-root `tsconfig.eslint.json` — parsing
 * the Playwright specs under the root project loses all `@playwright/test`
 * types (everything degrades to `any`) and drowns the run in spurious
 * `no-unsafe-*` errors. Mirrors the root rule set (`no-explicit-any`,
 * `no-console`, unused-vars) so the package joins the `pnpm -r lint` gate with
 * the same guarantees as apps/api|worker|web.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  env: {
    node: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'node_modules', 'playwright-report', 'test-results', '.auth'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  overrides: [
    {
      // Operator-facing prompt / diagnostic surfaces legitimately write to
      // stdout: `manualCheckpoint` renders the attended-run operator prompt and
      // the bulk-wizard param-readback is a headed-run visual diagnostic. This
      // is test tooling, not application logging, so `no-console` is relaxed
      // here rather than scattering per-line inline disables.
      files: ['src/support/manual-checkpoint.ts', 'src/pages/bulk-offer-wizard.page.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
