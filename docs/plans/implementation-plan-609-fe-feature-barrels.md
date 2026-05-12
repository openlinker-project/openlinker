# Implementation Plan — FE feature public barrels (#609)

## Goal

Close H6 / FE-7 of Modularity Thread H. Add a per-feature public-surface barrel (`features/<name>/index.ts`) and enforce via ESLint that cross-feature imports — and plugin-to-feature imports — go through the barrel rather than deep-importing private internals.

Out-of-tree plugin authors need a stable, documented public surface to consume a feature's hooks/types/components without reaching past its private files. Core features need a contract that can evolve without breaking unknown downstream imports.

## Layer classification

**Frontend, DX-shaped.** No backend changes, no schema changes. Pure import-graph hygiene + ESLint rule + a docs section.

## Non-goals

- **Not** migrating `pages/ → features/` imports. There are 128 of those today. Pages are part of the host composition (the same dependency layer as `app/` for this purpose) and are allowed to deep-import for now — they're never distributed as plugins. Catching them in the ESLint rule would force a 128-import migration that is mechanically large with low marginal value. Follow-up if/when needed.
- **Not** introducing path aliases (`@openlinker/web/features/<name>`). The codebase uses relative imports throughout `apps/web/src/`; converting to aliases is out of scope for this PR.
- **Not** consolidating duplicated cross-feature types into `shared/`. That's a different cleanup (H4 / #607, already in flight).
- **Not** changing what each feature actually exposes (no new abstractions, no new types). The barrel re-exports what's already being consumed today — nothing more, nothing less.

## Research summary

### Current cross-boundary import inventory

`grep -rEn "from '\.\./\.\./([a-z-]+)/" apps/web/src/features` and the same against `apps/web/src/plugins/` produce **26 deep imports across feature boundaries**:

| Target feature | feature → | plugin → | Total | Public surface needed |
|---|---:|---:|---:|---|
| `connections` | 4 | 3 | 7 | `Connection`, `CoreCapability` types; `useConnectionsQuery`, `useProductMasterConnections`, `useConfigureWebhooksMutation`, `useUpdateConnectionCredentialsMutation` hooks; `ConnectionEntityLabel` component |
| `content` | 4 | 0 | 4 | `SuggestionDialog` component; `resolveSuggestChannel` helper |
| `products` | 3 | 0 | 3 | `useProductQuery`, `useProductsQuery` hooks; `Product`, `ProductVariant` types |
| `allegro` | 2 | 0 | 2 | `useResponsibleProducersQuery`, `useUploadSafetyAttachmentMutation` hooks |
| `mappings` | 1 | 1 | 2 | `useAllegroCategoriesQuery`, `useMappingOptions` hooks; `MappingOption` type |
| `customers` | 1 | 0 | 1 | `useCustomerQuery` hook |
| `adapters` | 1 | 0 | 1 | `useAdaptersQuery` hook |
| `sync-jobs` | 1 | 0 | 1 | `TriggerSyncDialog` component |

Plus one cross-feature target on the new `connections` barrel that became visible only after #639 (the `Connection` barrel-only PR) landed: the `connections.types` file is already in the consumption path via `features/connections/api/connections.types`.

### Pages → features (out of scope)

128 imports across 17 page modules. Same shape (deep relative), same theoretical problem, but pages are not a plugin author concern. Deferred.

### Existing barrel precedent

- BE: `@openlinker/core/listings` exposes pure contracts via the main barrel; runtime wiring on `@openlinker/core/listings/services` (#337/#359).
- FE: `apps/web/src/shared/plugins/index.ts` (added in #578/#579) is the closest analogue — re-exports the public contract.
- The Connection-barrel-only PR (#591/#639) shows the exact import-rewrite shape: `features/connections/api/connections.types` → `features/connections` for the `Connection` type.

So the convention is already established; #609 generalizes it to every feature that gets cross-imported.

## Design

### Barrel shape

Each `features/<name>/index.ts` exports:

```ts
// features/<name>/index.ts

// Public types
export type { ... } from './api/<name>.types';

// Public hooks (query/mutation)
export { useXxxQuery } from './hooks/use-xxx-query';
export { useYyyMutation } from './hooks/use-yyy-mutation';

// Public components (only if cross-feature/plugin-consumed)
export { SomeComponent } from './components/some-component';
```

What goes in:
- **Types** that other features/plugins compose on (`Connection`, `Product`, `MappingOption`, …)
- **Query/mutation hooks** that other features/plugins call (`useConnectionsQuery`, `useCustomerQuery`, …)
- **Components** that other features/plugins render (`TriggerSyncDialog`, `ConnectionEntityLabel`, `SuggestionDialog`, …)

What stays out:
- Internal hooks / helpers used only within the feature
- Form schemas (consumed only by their owning form)
- DOM-private subcomponents
- Test utilities

If something isn't currently cross-imported, it doesn't go in the barrel — adding it pre-emptively bloats the public surface for hypothetical future consumers.

### ESLint rule

A new `no-restricted-imports` override on `apps/web/src/features/**` and `apps/web/src/plugins/**` bans deep paths into `features/<other>/...` and only allows the barrel:

```js
{
  files: ['apps/web/src/features/**/*.{ts,tsx}', 'apps/web/src/plugins/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            // Match cross-feature deep paths via the feature's own slug. Cross-
            // feature imports today are relative (`../../connections/api/...`)
            // and do NOT contain a literal `features/` segment in the import
            // string — so a `**/features/*/...` pattern would not match them.
            // Enumerate the eight cross-imported feature slugs via brace
            // expansion instead. Same-feature relative imports (`../api/foo`)
            // are not matched because the basename `foo` is a single segment,
            // not split into `<slug>/<sub>`.
            //
            // Adding a new cross-imported feature: update the brace list and
            // the documentation surface in docs/frontend-architecture.md.
            group: [
              '**/{adapters,allegro,connections,content,customers,mappings,products,sync-jobs}/api/**',
              '**/{adapters,allegro,connections,content,customers,mappings,products,sync-jobs}/hooks/**',
              '**/{adapters,allegro,connections,content,customers,mappings,products,sync-jobs}/components/**',
              '**/{adapters,allegro,connections,content,customers,mappings,products,sync-jobs}/lib/**',
              '**/{adapters,allegro,connections,content,customers,mappings,products,sync-jobs}/types/**',
            ],
            message:
              "Cross-feature imports must target the feature's public barrel (`features/<name>`), not its internals. See docs/frontend-architecture.md § Feature public surface.",
          },
        ],
      },
    ],
  },
},
```

**Same-feature imports** stay unrestricted — `features/connections/components/foo.tsx` can still `import { ... } from '../api/connections.types'`. The matcher only fires when a cross-feature slug appears as an adjacent path segment. `../api/connections.types` is segmented as `[.., api, connections.types]`; `connections.types` is a single basename, not a `connections` segment followed by `types`, so the rule doesn't trigger.

**Cross-feature imports** match because the path becomes `[.., .., connections, api, …]` — the `connections` segment + `api` segment + something deeper exists, which is exactly the banned shape.

**Verification step**: after Step 2, write a deliberately-bad cross-feature import and confirm lint errors. Without this manual check, a typo in the brace list could silently let imports through.

**Pages exemption**: rule only fires inside `features/**` and `plugins/**`. Pages are not listed.

### Documentation

`docs/frontend-architecture.md` gets a new "Feature Public Surface" section under "Folder Conventions" describing:
- Each cross-imported feature exposes a public barrel at `features/<name>/index.ts`
- The barrel is the only entry point for cross-feature / plugin consumers
- What goes in (types, query/mutation hooks, components) vs what stays out (internal helpers, form schemas, sub-components)
- The ESLint rule that enforces it

## Step-by-step plan

### Step 1 — Add the 8 feature barrels

For each target feature, create `index.ts` re-exporting exactly the cross-consumed surface (no more, no less):

| File | Re-exports |
|---|---|
| `features/connections/index.ts` | `Connection`, `ConnectionStatus`, `PlatformType`, `CoreCapability`, `CORE_PLATFORM_TYPES`, `CORE_CAPABILITY_VALUES` types; `useConnectionsQuery`, `useProductMasterConnections`, `useConfigureWebhooksMutation`, `useUpdateConnectionCredentialsMutation` hooks; `ConnectionEntityLabel` component |
| `features/content/index.ts` | `SuggestionDialog` component; `resolveSuggestChannel` helper |
| `features/products/index.ts` | `useProductQuery`, `useProductsQuery` hooks; `Product`, `ProductVariant` types |
| `features/allegro/index.ts` | `useResponsibleProducersQuery`, `useUploadSafetyAttachmentMutation` hooks |
| `features/mappings/index.ts` | `useAllegroCategoriesQuery`, `useMappingOptions` hooks; `MappingOption` type |
| `features/customers/index.ts` | `useCustomerQuery` hook |
| `features/adapters/index.ts` | `useAdaptersQuery` hook |
| `features/sync-jobs/index.ts` | `TriggerSyncDialog` component |

Acceptance: each new `index.ts` is type-checked, and each re-export resolves to the same symbol it previously did.

### Step 2 — Migrate the 26 cross-boundary imports

Rewrite the 19 feature-→-feature and 7 plugin-→-feature deep imports to target the barrel:

```ts
// Before
import { useConnectionsQuery } from '../../connections/hooks/use-connections-query';
import type { Connection } from '../../connections/api/connections.types';

// After
import { useConnectionsQuery, type Connection } from '../../connections';
```

Test files (`*.test.tsx`) inside `features/**` and `plugins/**` are migrated too — they share the same import rule and would otherwise lint-fail at the next run.

Acceptance: `grep -rEn "from '\.\./\.\./[a-z-]+/(api|hooks|components|lib|types)/" apps/web/src/features apps/web/src/plugins` returns zero matches (including test files).

### Step 3 — Add the ESLint guard

Add the `no-restricted-imports` override stanza described in Design. Place it next to the existing `apps/web/src/features/**` and `apps/web/src/plugins/**` rules in `.eslintrc.js`.

Acceptance: `pnpm lint` passes with zero errors; manually verify that re-introducing a deep cross-feature import triggers the new rule.

### Step 4 — Document

Add the "Feature Public Surface" subsection under "Folder Conventions" in `docs/frontend-architecture.md`. Cross-link from the existing "Dependency Rules" section.

### Step 5 — Quality gate + commit

```bash
pnpm lint        # 0 errors
pnpm type-check  # clean
pnpm test        # all passing
```

Conventional commit:

```
refactor(web): introduce per-feature public barrels (#609)

Each cross-imported FE feature now exposes a public barrel at
features/<name>/index.ts. ESLint bans deep cross-feature paths
from features/ and plugins/ — the barrel is the only seam. Pages
are intentionally exempt (host composition layer, not plugins).
Closes #609.
```

## Validation

- **Architecture**: introduces the public-surface seam Thread H called out. No new dependencies, no layer-direction changes.
- **Naming**: matches existing FE convention (re-export-only barrels, `index.ts`, kebab-case files).
- **Testing**: import migrations are mechanical; full test suite covers behaviour. No new tests required — the barrels are pure re-exports.
- **Security**: no change to request paths or auth gates.
- **Lint**: rule lands the H6 enforcement; same import-pattern-matching mechanism used elsewhere in the config.

## Risks & open questions

- **Barrel cycle risk**: a barrel can introduce circular imports if a feature both consumes from another feature's barrel AND is consumed by that other feature. None of the 26 imports today form a cycle, but worth watching when adding the third edge in a multi-feature chain.
- **Bundle size**: re-export barrels are tree-shakable when consumers use named imports and the project ships ESM. Vite/Rollup handle this; no measurable impact expected.
- **`connections` feature is the hot spot**: 7 cross-imports converge here. If the surface grows, splitting `connections` into sub-features (e.g. `connections/core` + `connections/wizards`) becomes the next H-thread question — out of scope today.

## Out-of-scope follow-ups (not this PR)

- `pages/ → features/` migration (128 imports). Same shape, lower priority since pages are host code, not plugins.
- `app/api/api-client.ts` → feature barrels. The host composes per-feature `createXApi` factories via 19 deep imports; bringing `app/**` under the rule is the natural twin of the pages migration and would normalise the full host surface.
- Hoisting cross-feature types into `shared/types/` where reuse warrants it (would shrink barrels). Deferred.
- Path aliases for `apps/web/src/features/<name>`. Out of scope.
- Move `AllegroCreateOfferWizard` from `features/listings/components/` into `plugins/allegro/`. The wizard is platform-specific by name; surfacing it from the listings barrel is a transitional shape. When the next platform's create-offer wizard lands, inline the platform wizards into their respective `plugins/<platform>/` packages so the listings barrel stays platform-agnostic.

## Implementation note (post-plan)

The plan inventoried 26 cross-imports across 8 features (adapters, allegro, connections, content, customers, mappings, products, sync-jobs). During Step 3 (ESLint enforcement) two further plugin → feature imports surfaced — `plugins/plugin.types.ts` imports `CreateOfferRequest` and `plugins/allegro/index.ts` imports `AllegroCreateOfferWizard` from `features/listings/`. The pattern matcher only fires on slugs present in its enumerated list, so adding a 9th barrel (`features/listings/index.ts`) and a 9th slug was necessary to bring those imports under the rule. Final shipped scope: 9 barrels, 28 imports migrated.
