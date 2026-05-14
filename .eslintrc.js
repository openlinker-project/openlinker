module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'eslint-comments'],
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
    // #598: enforce `import type { Foo }` for type-only imports so workspace
    // packages don't accidentally pull a value-import dependency into the
    // module graph when only the type is needed. Mixed value/type imports
    // contributed to the #337 runtime cycle the listings barrel split was
    // meant to fix; this rule is the structural guard against re-introducing
    // that class of bug as new bounded contexts land.
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
        disallowTypeAnnotations: true,
      },
    ],
    '@typescript-eslint/no-import-type-side-effects': 'error',
    // #669: every `eslint-disable*` directive must carry an inline reason
    // describing why the disable is justified. CLAUDE.md § Code Quality Rules:
    // "No `// eslint-disable` without a specific reason in the same comment".
    // Syntax expected by the rule: `// eslint-disable-next-line rule -- reason`.
    // Pairs with `no-aggregating-enable` so blanket re-enables can't sneak
    // around the per-directive justification. `no-unused-disable` is
    // intentionally NOT enabled here — that cleanup is a separate sweep.
    'eslint-comments/require-description': ['error', { ignore: [] }],
    'eslint-comments/no-aggregating-enable': 'error',
    // Discourage deep relative imports - prefer path aliases for cross-layer/cross-package imports
    // Note: Infrastructure/persistence layers use relative imports to avoid runtime ERR_PACKAGE_PATH_NOT_EXPORTED errors
    // These warnings are acceptable for now - consider path aliases when refactoring
    'no-restricted-imports': [
      'warn',
      {
        patterns: [
          {
            group: [
              '../../domain/*',
              '../../infrastructure/*',
              '../../../domain/*',
              '../../../infrastructure/*',
            ],
            message:
              'Use path aliases (@openlinker/*) for cross-layer imports instead of deep relative paths. Exception: infrastructure/persistence layers may use relative imports to avoid runtime errors.',
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
              {
                // #607: shared/ must stay domain-agnostic — no marketplace-named
                // imports. Pairs with the `**/features/**` rule above:
                //   - `features/**` catches the cross-layer case
                //     (shared/ importing from features/{platform}/).
                //   - this rule catches the intra-shared case (someone
                //     reintroducing a `shared/lib/allegro-error-mapping.ts`
                //     and importing it from another shared/ file).
                //
                // The globs DO also match npm packages with these tokens in
                // their names (e.g. a hypothetical `@shopify/polaris` import).
                // That's deliberate: any marketplace-shaped behaviour belongs
                // in `features/{platform}/`, not in `shared/`. If a legitimate
                // npm-package import ever needs to land here, the rule should
                // be revisited rather than disabled per-line — domain
                // agnosticism is the whole point of `shared/`.
                group: [
                  '**/*allegro*',
                  '**/*prestashop*',
                  '**/*shopify*',
                  '**/*ebay*',
                  '**/*amazon*',
                ],
                message:
                  'shared/ must stay domain-agnostic — no marketplace-named imports. Move the marketplace bit into features/{platform}/ and pass it into the shared primitive as a prop or callback (#607).',
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
      // `shared/plugins/` is the FE plugin-contract surface (#578/#579, #702).
      // The unified `OpenLinkerPlugin` shape necessarily references types that
      // live in `app/` and `features/`:
      //   - `Connection`, `EditConnectionFormValues` — platform-side bag shapes (#578/#579)
      //   - `Role` — declarative role gate on `NavContribution` (#610)
      //   - `ApiRequest`, `PluginApiNamespaces` — build-side `apiNamespaces` factory (#604/#605)
      //   - `CreateOfferRequest` — `OfferCreationWizardProps.initialValues` (#608)
      // Each is a deliberate pinhole. Hoisting all of them into `shared/types/`
      // would invert the dependency direction and inflate `shared/` with
      // feature-private surface — keeping the exemption narrow + explicit
      // documents which seams plugins observably depend on.
      files: ['apps/web/src/shared/plugins/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/features/**', '**/pages/**', '**/app/**'],
                importNamePattern:
                  '^(?!Connection$|EditConnectionFormValues$|Role$|ApiRequest$|PluginApiNamespaces$|CreateOfferRequest$).+',
                message:
                  'shared/plugins/ may only type-import a narrow set of contract surface types (Connection, EditConnectionFormValues, Role, ApiRequest, PluginApiNamespaces, CreateOfferRequest) from features/app. All other feature/app imports remain banned.',
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
                group: ['**/pages/**', '**/plugins/**'],
                message: 'Feature modules must not import page or plugin modules.',
              },
              {
                group: ['@radix-ui/*', '@tanstack/react-table', '@tanstack/react-virtual'],
                message:
                  'Headless UI libraries are wrapped by primitives in shared/ui/. Import the project primitive (e.g. Dialog, DataTable) instead of the library directly.',
              },
              {
                // Cross-feature imports must target the feature's public barrel
                // (`features/<name>`), not its internals (#609).
                //
                // The `ignore` matcher used by `no-restricted-imports` does
                // NOT support brace expansion — each slug/part combination
                // is listed explicitly. `**/<slug>/<part>/**` matches across
                // any relative depth (`allowRelativePaths: true`); same-
                // feature `../<part>/<file>` does NOT match because there is
                // no `<slug>` segment.
                //
                // Adding a new cross-imported feature: extend the slug list
                // below and update docs/frontend-architecture.md.
                group: [
                  '**/adapters/api/**',
                  '**/adapters/hooks/**',
                  '**/adapters/components/**',
                  '**/adapters/lib/**',
                  '**/adapters/types/**',
                  '**/allegro/api/**',
                  '**/allegro/hooks/**',
                  '**/allegro/components/**',
                  '**/allegro/lib/**',
                  '**/allegro/types/**',
                  '**/connections/api/**',
                  '**/connections/hooks/**',
                  '**/connections/components/**',
                  '**/connections/lib/**',
                  '**/connections/types/**',
                  '**/content/api/**',
                  '**/content/hooks/**',
                  '**/content/components/**',
                  '**/content/lib/**',
                  '**/content/types/**',
                  '**/customers/api/**',
                  '**/customers/hooks/**',
                  '**/customers/components/**',
                  '**/customers/lib/**',
                  '**/customers/types/**',
                  '**/listings/api/**',
                  '**/listings/hooks/**',
                  '**/listings/components/**',
                  '**/listings/lib/**',
                  '**/listings/types/**',
                  '**/mappings/api/**',
                  '**/mappings/hooks/**',
                  '**/mappings/components/**',
                  '**/mappings/lib/**',
                  '**/mappings/types/**',
                  '**/products/api/**',
                  '**/products/hooks/**',
                  '**/products/components/**',
                  '**/products/lib/**',
                  '**/products/types/**',
                  '**/sync-jobs/api/**',
                  '**/sync-jobs/hooks/**',
                  '**/sync-jobs/components/**',
                  '**/sync-jobs/lib/**',
                  '**/sync-jobs/types/**',
                ],
                message:
                  "Cross-feature imports must target the feature's public barrel (`features/<name>`), not its internals. See docs/frontend-architecture.md § Feature public surface.",
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
              {
                // Plugins consume feature publics through the per-feature
                // barrel only — same shape as the cross-feature ban inside
                // features/ (#609). Brace-expansion is unsupported by the
                // matcher; each slug/part is enumerated below.
                group: [
                  '**/adapters/api/**',
                  '**/adapters/hooks/**',
                  '**/adapters/components/**',
                  '**/adapters/lib/**',
                  '**/adapters/types/**',
                  '**/allegro/api/**',
                  '**/allegro/hooks/**',
                  '**/allegro/components/**',
                  '**/allegro/lib/**',
                  '**/allegro/types/**',
                  '**/connections/api/**',
                  '**/connections/hooks/**',
                  '**/connections/components/**',
                  '**/connections/lib/**',
                  '**/connections/types/**',
                  '**/content/api/**',
                  '**/content/hooks/**',
                  '**/content/components/**',
                  '**/content/lib/**',
                  '**/content/types/**',
                  '**/customers/api/**',
                  '**/customers/hooks/**',
                  '**/customers/components/**',
                  '**/customers/lib/**',
                  '**/customers/types/**',
                  '**/listings/api/**',
                  '**/listings/hooks/**',
                  '**/listings/components/**',
                  '**/listings/lib/**',
                  '**/listings/types/**',
                  '**/mappings/api/**',
                  '**/mappings/hooks/**',
                  '**/mappings/components/**',
                  '**/mappings/lib/**',
                  '**/mappings/types/**',
                  '**/products/api/**',
                  '**/products/hooks/**',
                  '**/products/components/**',
                  '**/products/lib/**',
                  '**/products/types/**',
                  '**/sync-jobs/api/**',
                  '**/sync-jobs/hooks/**',
                  '**/sync-jobs/components/**',
                  '**/sync-jobs/lib/**',
                  '**/sync-jobs/types/**',
                ],
                message:
                  'Plugins must import features through the public barrel (`features/<name>`), not its internals. See docs/frontend-architecture.md § Feature public surface.',
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
      excludedFiles: ['apps/web/src/**/*.test.{ts,tsx}', 'apps/web/src/**/*.spec.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "BinaryExpression[operator=/^(===|!==)$/][left.property.name='platformType'][right.type='Literal']",
            message:
              "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/. Use usePlatform()/usePlatforms() from shared/plugins, or capability checks (supportedCapabilities.includes('…')). See #578/#579.",
          },
          {
            selector:
              "BinaryExpression[operator=/^(===|!==)$/][right.property.name='platformType'][left.type='Literal']",
            message:
              "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/. Use usePlatform()/usePlatforms() from shared/plugins, or capability checks (supportedCapabilities.includes('…')). See #578/#579.",
          },
        ],
      },
    },
    {
      // Anti-regression guard (#702): the old `WebPlugin` / `PlatformPlugin` /
      // `IN_TREE_PLUGINS` symbols were collapsed into a single `OpenLinkerPlugin`
      // shape. Banning them as identifiers catches both accidental re-creation
      // (a future PR re-introduces the name) and a half-merged refactor (a
      // call site still references the old name after a partial rename).
      // JSDoc comments are not parsed as identifiers, so historical references
      // in new-file headers (`Renamed from usePlugin`...) are unaffected.
      files: ['apps/web/src/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "Identifier[name='WebPlugin']",
            message:
              '`WebPlugin` was unified into `OpenLinkerPlugin` (#702). Import `OpenLinkerPlugin` from `shared/plugins`.',
          },
          {
            selector: "Identifier[name='PlatformPlugin']",
            message:
              '`PlatformPlugin` was unified into `OpenLinkerPlugin` (#702). For the runtime view returned by `usePlatform()`, import `Platform` from `shared/plugins`.',
          },
          {
            selector: "Identifier[name='IN_TREE_PLUGINS']",
            message:
              '`IN_TREE_PLUGINS` was merged into the single `plugins` array (#702). Import `plugins` from `apps/web/src/plugins`.',
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
      // package at all would invert the dependency direction (#592). ORM
      // entities are infrastructure detail and must never leak into a port
      // file (#594).
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
                  '@openlinker/core/*/orm-entities',
                  '@openlinker/core/*/*.tokens',
                  '@openlinker/integrations-*/**',
                ],
                message:
                  "Port and capability files must import cross-context types via the top-level package barrel — e.g. `import { Connection } from '@openlinker/core/identifier-mapping'` — never via deep sub-paths. ORM-entity sub-barrels (`@openlinker/core/*/orm-entities`) are host-only — they must not appear on a port's import list so the contract surface stays framework-neutral (#594). Symbol DI tokens (`@openlinker/core/*/*.tokens`) are re-exported from the top-level context barrel; deep paths are forbidden (#595). Integration-package imports invert the dependency direction.",
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
      // (see #591). ORM-entity sub-barrels (`@openlinker/core/*/orm-entities`)
      // are host-only — plugins must never consume them or they'd be
      // coupled to TypeORM (#594). The package.json wildcards were dropped
      // — deep aliases now fail at Node runtime; this rule catches them at
      // lint time.
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
                  '@openlinker/core/*/orm-entities',
                  '@openlinker/core/*/*.tokens',
                ],
                message:
                  'Integration packages must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths, ORM-entity sub-barrels, or `*.tokens` paths. Deep imports leak unstable internals; ORM-entity imports couple the plugin to TypeORM; deep token paths fragment the DI surface. See #591, #594, and #595.',
              },
            ],
          },
        ],
      },
    },
    {
      // Backend host apps (api, worker) — same rule, locked behind us. The
      // package.json wildcards were dropped in #591; deep aliases fail at
      // Node runtime. This rule makes the failure mode "PR fails CI" not
      // "production crash". Scoped to apps/{api,worker} — apps/web is a
      // browser SPA that does not import `@openlinker/core` and has its
      // own layer-boundary `no-restricted-imports` overrides (#604) we
      // must not stomp by matching `apps/**/*.ts` broadly.
      files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
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
                  '@openlinker/core/*/*.tokens',
                ],
                message:
                  'Backend apps must import from `@openlinker/core/<context>` top-level barrels — never deep sub-paths. The package.json wildcards were dropped in #591; deep aliases now fail at Node runtime. Symbol DI tokens are re-exported from the top-level barrel (#595).',
              },
            ],
          },
        ],
      },
    },
  ],
};
