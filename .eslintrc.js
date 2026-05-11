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
      files: ['apps/web/**/*.{ts,tsx}'],
      env: {
        browser: true,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      rules: {
        '@typescript-eslint/no-redundant-type-constituents': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/require-await': 'off',
      },
    },
    {
      // Layer boundary: shared/ must not import from higher layers.
      // Exception: shared/auth/ is exempt from the fetch restriction (see override below).
      files: ['apps/web/src/shared/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/features/**', '**/pages/**', '**/app/**'],
                message: 'Shared modules must not import feature, page, or app modules.',
              },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          {
            name: 'fetch',
            message: 'Use API client modules from shared/api instead of raw fetch().',
          },
        ],
      },
    },
    {
      // `shared/plugins/` is the FE plugin-contract surface (#578/#579). It
      // necessarily references the `Connection` shape that plugins receive
      // and the form-value shapes plugins compose into. The Connection type
      // lives in `features/connections/api/` today; making this exemption
      // narrow keeps `shared/plugins/` cleanly typed without hoisting the
      // entire connections domain into `shared/` for one type.
      files: ['apps/web/src/shared/plugins/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/features/**', '**/pages/**', '**/app/**'],
                importNamePattern: '^(?!Connection$|EditConnectionFormValues$).+',
                message:
                  'shared/plugins/ may only type-import `Connection` and `EditConnectionFormValues` from features/. All other feature imports remain banned.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/web/src/features/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/pages/**'],
                message: 'Feature modules must not import page modules.',
              },
              {
                group: ['@radix-ui/*', '@tanstack/react-table', '@tanstack/react-virtual'],
                message:
                  'Headless UI libraries are wrapped by primitives in shared/ui/. Import the project primitive (e.g. Dialog, DataTable) instead of the library directly.',
              },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          {
            name: 'fetch',
            message: 'Use API client modules from shared/api instead of raw fetch().',
          },
        ],
      },
    },
    {
      // Session adapter is low-level auth infra that the API client itself depends on —
      // it must use raw fetch() and is exempt from the no-restricted-globals rule.
      files: ['apps/web/src/shared/auth/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-globals': 'off',
      },
    },
    {
      files: ['apps/web/src/pages/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/app/**'],
                message: 'Page modules must not import app modules.',
              },
              {
                group: ['@radix-ui/*', '@tanstack/react-table', '@tanstack/react-virtual'],
                message:
                  'Headless UI libraries are wrapped by primitives in shared/ui/. Import the project primitive (e.g. Dialog, DataTable) instead of the library directly.',
              },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          {
            name: 'fetch',
            message: 'Use API client modules from shared/api instead of raw fetch().',
          },
        ],
      },
    },
    {
      // Same rule for app/ — TooltipProvider etc. must come from shared/ui wrappers.
      files: ['apps/web/src/app/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@radix-ui/*', '@tanstack/react-table', '@tanstack/react-virtual'],
                message:
                  'Headless UI libraries are wrapped by primitives in shared/ui/. Import the project primitive instead of the library directly.',
              },
            ],
          },
        ],
      },
    },
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
      files: ['**/*.spec.tsx', '**/*.test.tsx'],
      env: {
        browser: true,
      },
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
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
    {
      // FE platformType is an opaque string post-#578/#579. Literal-equality
      // dispatch (`connection.platformType === 'allegro'`, etc.) is forbidden
      // outside the in-tree plugin packages — use `usePlugin()` / `usePlugins()`
      // or capability checks (`supportedCapabilities.includes('OfferManager')`)
      // instead. The single legitimate use is inside `apps/web/src/plugins/<name>/`
      // where each plugin keys on its own `platformType` constant.
      //
      // Selector scope: member-access on one side AND a string Literal on the
      // other. Standalone-variable comparisons inside platform-specific helper
      // fns (e.g. `if (platformType !== 'allegro') return null` at the top of
      // `allegro-seller-panel-url.ts`) are NOT caught, and they should not be:
      // those helpers advertise their platform in the filename and fail safe
      // for non-matching inputs.
      files: ['apps/web/src/{features,pages,app}/**/*.{ts,tsx}'],
      excludedFiles: [
        'apps/web/src/**/*.test.{ts,tsx}',
        'apps/web/src/**/*.spec.{ts,tsx}',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "BinaryExpression[operator=/^(===|!==)$/][left.property.name='platformType'][right.type='Literal']",
            message:
              "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/. Use usePlugin()/usePlugins() from shared/plugins, or capability checks (supportedCapabilities.includes('…')). See #578/#579.",
          },
          {
            selector:
              "BinaryExpression[operator=/^(===|!==)$/][right.property.name='platformType'][left.type='Literal']",
            message:
              "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/. Use usePlugin()/usePlugins() from shared/plugins, or capability checks (supportedCapabilities.includes('…')). See #578/#579.",
          },
        ],
      },
    },
    {
      // Port, capability, and port-local type files form the public contract
      // surface plugin adapters implement. They must import cross-context
      // types via the top-level package barrel — never deep sub-paths — so
      // plugin authors can model their imports on the contract without
      // copying brittle internal paths. Importing from an integration
      // package at all would invert the dependency direction (#592).
      files: ['libs/core/src/**/domain/ports/**/*.{port,capability,types}.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@openlinker/core/*/domain/**',
                  '@openlinker/core/*/application/**',
                  '@openlinker/core/*/infrastructure/**',
                  '@openlinker/integrations-*/**',
                ],
                message:
                  "Port and capability files must import cross-context types via the top-level package barrel — e.g. `import { Connection } from '@openlinker/core/identifier-mapping'` — never via deep sub-paths. Ports are the contract surface plugin authors implement; deep-path imports leak unstable internals, and integration-package imports invert the dependency direction.",
              },
            ],
          },
        ],
      },
    },
  ],
};

