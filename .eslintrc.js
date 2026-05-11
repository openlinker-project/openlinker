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
                group: ['**/features/**', '**/pages/**', '**/app/**', '**/plugins/**'],
                message: 'Shared modules must not import feature, page, app, or plugin modules.',
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
      files: ['apps/web/src/features/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/pages/**', '**/plugins/**'],
                message: 'Feature modules must not import page or plugin modules.',
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
                group: ['**/app/**', '**/plugins/**'],
                message: 'Page modules must not import app or plugin modules.',
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
      // Route modules (#606): mechanical one-export files whose only function
      // is the inline `lazy: async () => { const { X } = await import('...');
      // return { Component: X }; }` arrow. Annotating each with an explicit
      // `Promise<{ Component: ComponentType }>` is uniform busywork that adds
      // noise without catching real bugs — the structural return shape is
      // already constrained by React Router's `RouteObject.lazy` type. Turn
      // the rule off for these files specifically; the canonical rule stays
      // on everywhere else.
      files: ['apps/web/src/app/routes/*.route.tsx', 'apps/web/src/plugins/**/*.route.tsx'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
    {
      // Plugin boundary (#604): plugins compose pages/features/shared and may
      // reference the public type seam at `app/api/api-client` only. Importing
      // any other `app/` path would couple plugins to host internals (router,
      // layouts, app-shell) and defeat the seam introduced for OSS plugin
      // contribution. Enumerated explicitly because the `ignore`-style glob
      // negation we'd normally use ('**/app/**', '!**/app/api/api-client') is
      // unreliable across `ignore` versions; an explicit list is shorter than
      // arguing about it and reads honestly in the diff.
      files: ['apps/web/src/plugins/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/app/router*',
                  '**/app/app',
                  '**/app/app.tsx',
                  '**/app/layouts/**',
                  '**/app/routes/**',
                  '**/app/hooks/**',
                  '**/app/providers/**',
                  '**/app/api/api-client-provider*',
                ],
                message:
                  'Plugin modules must not import host internals (router, routes, layouts, hooks, providers, the API client provider hook). The public surface plugins may consume is app/api/api-client (types) and app/app-shell (NavGroup types) — anything else couples plugins to host implementation.',
              },
              {
                group: ['@radix-ui/*', '@tanstack/react-table', '@tanstack/react-virtual'],
                message:
                  'Headless UI libraries are wrapped by primitives in shared/ui/. Import the project primitive instead of the library directly.',
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
    {
      // Plugin contract surface: integration packages must consume only the
      // top-level `@openlinker/core/<context>` barrels. Deep-path imports
      // leak unstable internals and break when core refactors its layout
      // (see #591). The package.json wildcards were dropped — deep aliases
      // now fail at Node runtime; this rule catches them at lint time.
      files: ['libs/integrations/**/*.ts'],
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
                ],
                message:
                  'Integration packages must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths. Deep imports leak unstable internals; when core refactors, plugins break. See #591.',
              },
            ],
          },
        ],
      },
    },
    {
      // Host apps: same rule, locked behind us. The package.json wildcards
      // were dropped in #591; deep aliases fail at Node runtime. This rule
      // makes the failure mode "PR fails CI" not "production crash". Note
      // the order: this override runs AFTER the broader **/infrastructure/**
      // exemption above, so it wins for apps/**/infrastructure/** paths too.
      files: ['apps/**/*.ts'],
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
                ],
                message:
                  'Apps must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths. The package.json wildcards were dropped in #591; deep aliases now fail at Node runtime.',
              },
            ],
          },
        ],
      },
    },
  ],
};

