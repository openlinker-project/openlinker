# Implementation Plan: FE Plugin Registry + Open ApiClient (#604, #605)

**Date**: 2026-05-11
**Status**: Ready for implementation (tech-review fixes applied)
**Estimated Effort**: ~1–1.5 days

---

## 1. Task Summary

**Objective**: Introduce a minimal, build-time **frontend plugin registry** with named extension points (routes, nav items, API namespaces) and break the closed `ApiClient` interface into a core surface plus a typed plugin-augmentable surface. Migrate the two currently platform-specific seams (`allegro`, `prestashop`) into reference plugins to prove the mechanism.

**Context**: Both #604 and #605 are BLOCKER tech-debt items in **Modularity Thread H** (frontend OSS-readiness). A third-party plugin currently has nowhere to attach: every UI surface (routes, nav, API methods) is statically imported, and `ApiClient` is a single closed interface listing every feature by name. Mirrors the backend `PluginRegistryModule.forRoot({ plugins })` shape that landed in #572.

**Classification**: Frontend (`apps/web`).

---

## 2. Scope & Non-Goals

### In Scope
- A `WebPlugin` shape with three extension slots: `routes`, `navItems`, `apiNamespaces` (named `WebPlugin` to disambiguate from the BE `PluginEntry`, which is a NestJS module class — same word, different shape).
- A `definePlugin()` identity helper for ergonomic, type-checked authoring.
- A `plugins` barrel (`apps/web/src/plugins/index.ts`) — the **single edit point** an OSS contributor touches to enable a new plugin (mirrors `apps/api/src/plugins.ts`).
- Splitting `ApiClient` into `CoreApiClient` + a `PluginApiNamespaces` interface that plugins extend via TypeScript declaration merging.
- Refactoring `createApiClient()`, `app/routes/root.route.tsx`, and `app/app-shell.tsx` to iterate the registry.
- **Relocating** Allegro and PrestaShop route files (`allegro-callback.route.tsx`, `allegro-setup.route.tsx`, `prestashop-setup.route.tsx`) from `apps/web/src/app/routes/` into `apps/web/src/plugins/<name>/`. The recommendation explicitly states a third-party plugin must have "nowhere to attach" turned into "somewhere to drop a file" — keeping platform routes in `app/routes/` would only half-resolve the BLOCKER.
- Migrating the `allegro` API namespace into `allegroPlugin`.
- Updating `apps/web/src/test/test-utils.tsx` so the mock `ApiClient` follows the same Core + plugin shape, with an explicit **merge order** spec (see §6 Step 6).
- A new lint rule keeping `apps/web/src/plugins/` to a tight boundary (allowed to import `pages/`, `features/`, `shared/`, and the public types from `app/api/api-client`; forbidden from importing anything else in `app/`).
- Tests proving registry composition for all three slots, plus a **boot-time `id` uniqueness assertion**.
- Updating `docs/frontend-architecture.md` so the new top-level `plugins/` folder and its dependency direction are documented alongside `app/`, `pages/`, `features/`, `shared/`.

### Out of Scope
- Wizard registries (`connectionSetupWizards`, `offerCreationWizards`, `connectionConfigSections`) — tied to FE-5 / FE-7 (#608, #610). The `WebPlugin` shape will be **extensible to add them later** without breaking existing plugins.
- Lazy-loading / dynamic route registration (FE-3 / #606).
- Moving entire `features/allegro/` and `features/connections/.../prestashop-setup-form` directories into `plugins/<name>/`. The plugin shim re-exports the API factory and form component from the existing feature module; only the **route module** (already platform-specific and currently misplaced in `app/routes/`) moves.
- Any backend changes.
- i18n, design tokens, theme contract (other H-thread issues).
- Full rewrite of `buildNavGroups` — only add a contribution merge point; existing static groups stay.

### Constraints
- Must compile and pass `pnpm lint`, `pnpm type-check`, `pnpm test`.
- Cannot break the current operator UX (every existing route + API call must keep working).
- Must not introduce `any` types or string-keyed registries that defeat TS inference.
- FE uses **relative imports** (no `@/` alias is configured); all new files follow that convention.

---

## 3. Architecture Mapping

**Target Layer**: `apps/web/src/` — adds a new top-level `plugins/` folder peer to the documented `app/`, `pages/`, `features/`, `shared/`.

**New dependency rules** (to be added to `docs/frontend-architecture.md` §Dependency Rules):
- `plugins/` may import `pages/`, `features/`, `shared/`, and **type-only** from `app/api/api-client` (the public type seam for plugin authors).
- `plugins/` must not import from any other path under `app/` (router internals, layouts, app-shell).
- `app/` may import `plugins/` (the barrel) — same direction it already imports `pages/`.
- `pages/`, `features/`, `shared/` must not import `plugins/`.

Cross-boundary contract: `app/api/api-client.ts` exposes `ApiRequest` and `PluginApiNamespaces` as the **public extension API** for plugins. Plugins augment `PluginApiNamespaces` via `declare module '../../app/api/api-client'`.

**Existing services reused**:
- `createAllegroApi(request)` factory in `apps/web/src/features/allegro/api/allegro.api.ts` — re-used by `allegroPlugin` without modification.
- `PrestashopSetupForm` component and any feature-side mutations under `apps/web/src/features/connections/` — re-used by `prestashopPlugin` without modification (only the route module relocates).
- The 16 existing feature `*.api.ts` factories — all stay in `features/` and are still composed by `createApiClient`; only `allegro` moves into the plugin-augmented surface.

**New components required**:
- `apps/web/src/plugins/plugin.types.ts` — type definitions
- `apps/web/src/plugins/define-plugin.ts` — identity helper
- `apps/web/src/plugins/index.ts` — barrel listing in-tree plugins (the OSS contributor seam)
- `apps/web/src/plugins/merge-nav-contributions.ts` — pure helper, exported for testability
- `apps/web/src/plugins/allegro/index.ts` — first reference plugin
- `apps/web/src/plugins/allegro/allegro-callback.route.tsx` — relocated from `app/routes/`
- `apps/web/src/plugins/allegro/allegro-setup.route.tsx` — relocated from `app/routes/`
- `apps/web/src/plugins/prestashop/index.ts` — second reference plugin
- `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx` — relocated from `app/routes/`
- Module augmentation snippet in `plugins/allegro/index.ts` extending `PluginApiNamespaces`

**Plugin vs core justification**:
- Routes/APIs that are **platform-shaped** (Allegro OAuth callback, PrestaShop WebService setup, the Allegro typed API client) belong in plugins.
- Routes/APIs that are **capability-generic** (Dashboard, Orders, Products, Inventory, Customers, Listings, generic Connections list, Adapters, Jobs/Logs, Settings, Mappings, Prompt Templates, AI provider settings) stay in core because every plugin needs them as a host service.

---

## 4. External / Domain Research

### External system
N/A.

### Internal patterns
- **Backend mirror** — `apps/api/src/plugins.ts` (`export const apiPlugins: PluginEntry[]`) consumed by `PluginRegistryModule.forRoot({ plugins })` at `libs/core/src/integrations/plugin-registry.module.ts`. The FE registry uses the same "single edit point + iterate at composition time" shape, adapted to React (no Nest DI; plain composition).
- **Existing factory pattern** — every feature already exports a `create*Api(request)` factory that returns a typed namespace object. The plugin `apiNamespaces` slot just calls these factories — zero rework on the feature side.
- **Existing route module pattern** — each route file exports a `RouteObject` constant. The plugin `routes` slot just collects them.
- **Existing ESLint boundary pattern** — `.eslintrc.js` at the repo root enforces `shared/` → no features/pages/app, `features/` → no pages, `pages/` → no app. The new `plugins/` block follows the same shape.

---

## 5. Questions & Assumptions

### Open questions
- None blocking. All design decisions have safe defaults below.

### Assumptions
1. **Static barrel is sufficient for #604/#605.** The issue body explicitly endorses "Even a static, build-time `definePlugin({...})` collected from a `plugins/index.ts` barrel would unblock in-tree contribution and make the runtime path a later refactor, not a rewrite." Dynamic registration is FE-3/#606.
2. **Type-level extension via declaration merging is the right shape for `ApiClient`.** The issue body lists this as option (a) and is more idiomatic in TypeScript than option (b) (a generic `apiClient.plugin('shopify')` accessor that returns `unknown`). Declaration merging keeps full IntelliSense.
3. **Allegro and PrestaShop feature dirs stay in `features/`; only thin shims and the platform-specific route modules move to `plugins/`.** Physically relocating `features/allegro/` and the entire prestashop setup form belongs in a follow-up that tackles H6 (#609).
4. **`PluginApiNamespaces` augmentation is per-plugin local.** Each plugin file declares `declare module '../../app/api/api-client' { interface PluginApiNamespaces { allegro: AllegroApi } }`. Importing the plugin's barrel entry activates the typing — exactly what we want.
5. **Nav contributions are append-only and group-keyed by an open string `groupLabel`.** Open (not a closed union) so future plugins are not constrained by the current IA. Documented as a soft contract: contributors should prefer matching an existing group (`Operations` / `Diagnostics` / `Platform` / `Planned`); unknown labels create a new group at the end. If group sprawl becomes a problem, tighten to a closed union in a follow-up.
6. **`navItems` slot is wired and tested by a fixture plugin in unit tests; no in-tree plugin contributes a nav item in MVP.** First real consumer will be a follow-up plugin. The slot is intentional future-proofing for #608/#610.
7. **Mock merge order is `core → plugin namespaces → caller overrides`.** Spelled out in Step 6 so existing tests that override `allegro` continue to win against the plugin contribution.
8. **Route matching follows React Router specificity, not array order.** The Phase 3 implementation appends plugin routes to the children array; this controls which route appears first in the children list, but React Router resolves matches by path specificity, not order. Plugins cannot accidentally override an existing core path unless they declare the same exact path.

### Documentation gaps
- `docs/frontend-architecture.md` does not currently document `plugins/`. This plan adds it as part of the implementation diff so the doc and the code stay consistent on the same PR.

---

## 6. Proposed Implementation Plan

> **Conventions for every new file:** standard JSDoc header per `engineering-standards.md` §File Headers (Purpose + Context + optional `@module`). Kebab-case filenames; PascalCase types; camelCase values. No `any`. No `console.log`. No `eslint-disable` without an inline rationale.

### Phase 1 — Registry primitives (no host changes)

**Goal**: Land the `WebPlugin` shape, helper, and empty barrel. All existing code keeps compiling unchanged.

1. **Create `plugin.types.ts`**
   - **File**: `apps/web/src/plugins/plugin.types.ts`
   - **Action**: Define `WebPlugin`, `NavContribution`, `PluginApiNamespacesFactory`. Type-import `ApiRequest` and `PluginApiNamespaces` from `../app/api/api-client` (relative path — no `@/` alias). Shape:
     ```ts
     import type { RouteObject } from 'react-router-dom';
     import type { ApiRequest, PluginApiNamespaces } from '../app/api/api-client';

     export interface NavContribution {
       groupLabel: string;
       to: string;
       label: string;
       end?: boolean;
       countKey?: string;
     }

     export type PluginApiNamespacesFactory = (
       request: ApiRequest,
     ) => Partial<PluginApiNamespaces>;

     export interface WebPlugin {
       /** Stable id used in logs and the uniqueness assertion — kebab-case. */
       id: string;
       routes?: RouteObject[];
       navItems?: NavContribution[];
       apiNamespaces?: PluginApiNamespacesFactory;
     }
     ```
   - **Acceptance**: Compiles. No runtime change.

2. **Create `define-plugin.ts`**
   - **File**: `apps/web/src/plugins/define-plugin.ts`
   - **Action**: `export function definePlugin(plugin: WebPlugin): WebPlugin { return plugin; }` — identity helper for ergonomic, type-checked authoring.
   - **Acceptance**: Importable; passes lint.

3. **Create `merge-nav-contributions.ts` (pure helper, no host change yet)**
   - **File**: `apps/web/src/plugins/merge-nav-contributions.ts`
   - **Action**: Export pure function `mergePluginNavContributions(groups: NavGroup[], contributions: NavContribution[]): NavGroup[]`. For each contribution: find a group whose `label === groupLabel` and append; otherwise create a new `{ kind: 'live', label: groupLabel, items: [...] }` group at the end. Import `NavGroup` from `../app/app-shell` (or wherever the type currently lives — verify during implementation; relocate the type to a co-located `*.types.ts` file if it's defined inline in `app-shell.tsx`).
   - **Acceptance**: Pure helper, fully unit-testable; no app behaviour change.

4. **Create empty plugin barrel + boot-time id-uniqueness assertion**
   - **File**: `apps/web/src/plugins/index.ts`
   - **Action**:
     ```ts
     export const plugins: WebPlugin[] = [];

     // Boot-time invariant: plugin ids must be unique. Catches forks/copies
     // that forget to rename. Runs at module load (effectively dev/CI only —
     // the array is static, so this either passes once or fails CI).
     const ids = new Set<string>();
     for (const p of plugins) {
       if (ids.has(p.id)) {
         throw new Error(`Duplicate plugin id: "${p.id}". Plugin ids must be unique.`);
       }
       ids.add(p.id);
     }
     ```
   - **Acceptance**: Compiles; no behaviour change for an empty array.

### Phase 2 — Split `ApiClient` into core + plugin-augmentable surface

**Goal**: Type-level mechanism for plugins to contribute API namespaces, with `createApiClient()` iterating the registry. No namespaces actually move yet — that happens in Phase 5.

5. **Refactor `api-client.ts`**
   - **File**: `apps/web/src/app/api/api-client.ts`
   - **Action**:
     - Export `type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;` (named export so plugin types have a stable import target).
     - Add an empty augmentable surface:
       ```ts
       // eslint-disable-next-line @typescript-eslint/no-empty-interface -- canonical declaration-merging seam; plugins extend via `declare module`
       export interface PluginApiNamespaces {}
       ```
     - Rename the current `ApiClient` interface to `CoreApiClient` (16 namespaces unchanged for now).
     - Export `export type ApiClient = CoreApiClient & PluginApiNamespaces;`.
     - In `createApiClient()`, build the core namespaces object, then iterate `plugins` from `../../plugins`. For each plugin with an `apiNamespaces` factory, call it with `request` and `Object.assign` the result onto the api client. Return as `ApiClient` (single boundary cast; do not propagate `as ApiClient` deeper).
     - Merge order: **core → plugin contributions** (caller overrides do not apply here — they're a test-utils concern handled in Step 6).
   - **Acceptance**: `pnpm type-check` passes; `useApiClient()` consumers see no type change since `PluginApiNamespaces` is empty.

6. **Mirror the split in `test-utils.tsx`**
   - **File**: `apps/web/src/test/test-utils.tsx`
   - **Action**: Restructure the mock factory so it produces a client in this order:
     1. Build the core mock namespaces (existing 15 namespaces minus `allegro`, which moves in Step 11; for this step keep all 16 — Step 11 will delete `allegro` from the core mock).
     2. Merge plugin contributions from real `plugins` (using stubbed `request`).
     3. Merge caller overrides last so test-specific stubs always win.
     - Strip the explicit `allegro?: Partial<...>` field from the type; the union `Partial<CoreApiClient & PluginApiNamespaces>` already lets callers override allegro via declaration merging.
   - **Acceptance**: All existing tests still pass with no changes. Document the merge order in a short comment at the merge site.

### Phase 3 — Route extension point

**Goal**: Host iterates `plugin.routes` and appends them to the root route's children.

7. **Refactor `root.route.tsx`**
   - **File**: `apps/web/src/app/routes/root.route.tsx`
   - **Action**: Import `plugins` from `../../plugins` (relative). Build the children array by concatenating the existing core children list with `plugins.flatMap((p) => p.routes ?? [])`. Comment explains: "core operator routes first; plugin-contributed routes appended in registry order; React Router resolves matches by path specificity, not array position."
   - **Acceptance**: All current routes still resolve; type stays `RouteObject`.

### Phase 4 — Nav extension point

**Goal**: Host iterates `plugin.navItems` and merges them into nav groups.

8. **Wire `mergePluginNavContributions` into `app-shell.tsx`**
   - **File**: `apps/web/src/app/app-shell.tsx`
   - **Action**:
     - Import `plugins` from `../plugins` and `mergePluginNavContributions` from `../plugins/merge-nav-contributions`.
     - After `buildNavGroups({ isAdmin })` returns its static groups, pass them through `mergePluginNavContributions(groups, plugins.flatMap(p => p.navItems ?? []))`.
   - **Acceptance**: With zero plugin nav contributions, output is byte-for-byte identical to today.

### Phase 5 — `allegroPlugin`: API namespace + relocated routes

**Goal**: Move Allegro from "hardcoded in core" to "contributed by allegroPlugin." Primary correctness check for the registry.

9. **Relocate Allegro route files**
   - **Move (`git mv`)**:
     - `apps/web/src/app/routes/allegro-callback.route.tsx` → `apps/web/src/plugins/allegro/allegro-callback.route.tsx`
     - `apps/web/src/app/routes/allegro-setup.route.tsx` → `apps/web/src/plugins/allegro/allegro-setup.route.tsx`
   - **Fixup**: Adjust relative imports inside those files (paths to `pages/`, `features/`, `shared/` change by one level since the file moved deeper).
   - **Acceptance**: Routes still type as `RouteObject`; imports resolve.

10. **Create `plugins/allegro/index.ts`**
    - **File**: `apps/web/src/plugins/allegro/index.ts`
    - **Action**:
      ```ts
      import { createAllegroApi, type AllegroApi } from '../../features/allegro/api/allegro.api';
      import { definePlugin } from '../define-plugin';
      import { allegroCallbackRoute } from './allegro-callback.route';
      import { allegroSetupRoute } from './allegro-setup.route';

      declare module '../../app/api/api-client' {
        // eslint-disable-next-line @typescript-eslint/no-empty-interface -- declaration-merging augmentation
        interface PluginApiNamespaces {
          allegro: AllegroApi;
        }
      }

      export const allegroPlugin = definePlugin({
        id: 'allegro',
        routes: [allegroCallbackRoute, allegroSetupRoute],
        apiNamespaces: (request) => ({ allegro: createAllegroApi(request) }),
      });
      ```
    - **Acceptance**: Compiles.

11. **Remove allegro from core; register the plugin**
    - **Files**:
      - `apps/web/src/app/api/api-client.ts` — delete `allegro: AllegroApi;` from `CoreApiClient`, the `allegro: createAllegroApi(request),` line in the factory, and the now-unused `createAllegroApi`/`AllegroApi` imports.
      - `apps/web/src/plugins/index.ts` — `import { allegroPlugin } from './allegro';` and add to the `plugins` array.
      - `apps/web/src/app/routes/root.route.tsx` — delete the explicit `allegroCallbackRoute` and `allegroSetupRoute` imports and their entries in the hardcoded children list (the plugin's routes are appended via Phase 3).
      - `apps/web/src/test/test-utils.tsx` — delete the explicit `allegro?: Partial<...>` mock branch (typing still works via the augmented `PluginApiNamespaces`; the mock-factory plugin-merge step ensures the namespace is present unless overridden).
    - **Acceptance**:
      - `apiClient.allegro.startOAuth(…)` still type-checks at every call site.
      - `/integrations/allegro/connect/callback` and `/connections/new/allegro` still resolve in the running app.
      - Existing tests that override allegro continue to pass (merge order: plugin → caller override).
      - `pnpm type-check`, `pnpm lint`, `pnpm test` all pass.

### Phase 6 — `prestashopPlugin`: routes-only contribution

**Goal**: Validate that a routes-only plugin (no API namespace) works.

12. **Relocate the PrestaShop setup route and create the plugin**
    - **Move**: `apps/web/src/app/routes/prestashop-setup.route.tsx` → `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx` (fix up relative imports).
    - **File**: `apps/web/src/plugins/prestashop/index.ts`
      ```ts
      import { definePlugin } from '../define-plugin';
      import { prestashopSetupRoute } from './prestashop-setup.route';

      export const prestashopPlugin = definePlugin({
        id: 'prestashop',
        routes: [prestashopSetupRoute],
      });
      ```
    - **Then**:
      - `apps/web/src/plugins/index.ts` — add `prestashopPlugin` to the array.
      - `apps/web/src/app/routes/root.route.tsx` — delete the `prestashopSetupRoute` explicit import and child entry.
    - **Acceptance**: `/connections/new/prestashop` still resolves; type surface unchanged (no api namespace to declare).

### Phase 7 — Tests + lint guardrail + doc

**Goal**: Lock the design with tests, prevent boundary regressions, and document the new top-level folder.

13. **Test: registry composition**
    - **File**: `apps/web/src/plugins/plugin-registry.test.ts`
    - **Cases** (Vitest):
      - A fixture plugin whose `apiNamespaces` factory returns `{ shopify: { ping: () => 'pong' } }`, when wired through `createApiClient` with a stubbed `request`, yields a client where `client.shopify.ping()` returns `'pong'`.
      - `mergePluginNavContributions` appends to a matching group, creates a new group when unmatched.
      - A fixture plugin with `routes: [{ path: '/__test__/fixture', element: null }]` flows through the root-route children flattening.
      - **Caller-override wins**: a mock client with `{ allegro: { startOAuth: vi.fn() } }` produces a `startOAuth` reference equal to the caller's stub, not the real plugin contribution.
      - **Id uniqueness**: importing a `plugins/index.ts`-shaped module with two plugins sharing an id throws at module load (test via dynamic import of an inline fixture).
    - **Acceptance**: All cases pass.

14. **Test: allegroPlugin wiring**
    - **File**: `apps/web/src/plugins/allegro/allegro-plugin.test.ts`
    - **Action**: Smoke test that `allegroPlugin.routes` contains both expected route objects and that `allegroPlugin.apiNamespaces?.(stubRequest)` returns an object with an `allegro` key. No need to re-test `createAllegroApi` internals — covered by feature tests.
    - **Acceptance**: Test passes.

15. **Lint guardrail**
    - **File**: `.eslintrc.js` (repo root)
    - **Action**: Add a new override block for `apps/web/src/plugins/**/*.{ts,tsx}` forbidding imports from `app/**` **except** the `app/api/api-client` module. Also extend the existing `shared/` block to forbid `plugins/`, and add `plugins/` to the forbidden list in the `features/` and `pages/` blocks.
    - Concretely:
      ```js
      // New override
      {
        files: ['apps/web/src/plugins/**/*.{ts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  group: ['**/app/**', '!**/app/api/api-client', '!**/app/api/api-client.ts'],
                  message:
                    'Plugin modules may only import from app/api/api-client (the public type seam). Other app/ paths are not part of the plugin contract.',
                },
              ],
            },
          ],
        },
      }
      ```
    - **Verify**: A contrived `import { router } from '../../app/router'` from a plugin file is rejected; `import type { ApiRequest } from '../../app/api/api-client'` is allowed.

16. **Documentation update**
    - **File**: `docs/frontend-architecture.md`
    - **Action**: In §Folder Conventions, add `plugins/`: "build-time plugin registry; named extension points iterated by the host." In §Dependency Rules, add: "`app` may import `plugins`; `plugins` may import `pages`, `features`, `shared`, and type-only from `app/api/api-client`; `pages`/`features`/`shared` must not import `plugins`."
    - **Acceptance**: The doc and the lint rules agree on every directional arrow.

### Phase 8 — Quality gate

17. **Run the full gate**
    - `pnpm lint` — zero errors.
    - `pnpm type-check` — zero errors.
    - `pnpm test` (Vitest in `apps/web`, Jest in everything else) — all green.
    - Manually start the FE (`pnpm start:dev:web`) and confirm `/`, `/connections/new/allegro`, `/connections/new/prestashop`, and the Allegro OAuth callback URL all render without console errors. (UI / frontend changes require a real browser smoke per CLAUDE.md.)

---

## 7. Alternatives Considered

### Alternative 1 — Generic `apiClient.plugin('shopify')` accessor
- **Description**: Instead of declaration merging, `ApiClient` exposes a `plugin<T>(name: string): T` method that returns an opaque slice the plugin provides.
- **Why rejected**: Loses IntelliSense (`apiClient.allegro.startOAuth(...)` is far more discoverable than `apiClient.plugin<AllegroApi>('allegro').startOAuth(...)`). Forces every call site to either know a generic parameter or accept `unknown`. The issue body lists module augmentation as the preferred option (a).
- **Trade-offs**: Slightly simpler runtime; significantly worse DX.

### Alternative 2 — Runtime/dynamic plugin loading
- **Description**: Plugins ship as separate npm packages; the host reads a runtime manifest and dynamically imports them.
- **Why rejected**: FE-3/#606 territory (lazy loading) plus would require a per-plugin npm publishing pipeline before the static seam even exists. The issue explicitly endorses "static, build-time `definePlugin({...})` … make the runtime path a later refactor, not a rewrite."
- **Trade-offs**: True OSS distributability vs. simpler diff and faster unblock. We pick the unblock.

### Alternative 3 — Leave platform-specific routes in `app/routes/` and have the plugin barrel re-export them
- **Description**: `apps/web/src/plugins/allegro/index.ts` would `import { allegroCallbackRoute } from '../../app/routes/allegro-callback.route'` and contribute it.
- **Why rejected**: Half-resolves the BLOCKER. A contributor adding a Shopify plugin would still have to drop the route file inside `app/routes/` — i.e., "no plugin/extension registry exists in the FE" stays partly true. The cost of relocating two `allegro-*.route.tsx` files and one `prestashop-setup.route.tsx` is small (`git mv` + adjust relative imports); the payoff is that platform-specific code finally has a home.
- **Trade-offs**: Slightly bigger diff vs. cleaner long-term layout. We pick clean.

---

## 8. Validation & Risks

### Architecture compliance
- ✅ New `plugins/` folder is documented in §3 above and (per Phase 7 Step 16) added to `docs/frontend-architecture.md` in the same PR. Lint rules and doc agree.
- ✅ Frontend conventions: kebab-case file names; types in a `*.types.ts` file; explicit React Router route modules; one `createApiClient()` entrypoint.
- ✅ All new files include JSDoc headers per `engineering-standards.md` §File Headers.

### Naming conventions
- ✅ Files: `plugin.types.ts`, `define-plugin.ts`, `merge-nav-contributions.ts`, `allegro-plugin.test.ts`, `plugin-registry.test.ts` — kebab-case.
- ✅ Exports: `WebPlugin`, `NavContribution`, `definePlugin`, `allegroPlugin`, `prestashopPlugin` — PascalCase types, camelCase values.
- ✅ `WebPlugin` is named distinctly from BE `PluginEntry` (assumption #note in §5) to avoid the trap of contributors expecting symmetry between two structurally different things.

### Existing patterns
- ✅ Plugin slot shape (`routes`, `navItems`, `apiNamespaces`) mirrors what `apps/api/src/plugins.ts` does for the backend.
- ✅ `definePlugin` identity helper mirrors common patterns (e.g. Vite's `defineConfig`).
- ✅ Module augmentation of `PluginApiNamespaces` is canonical TS plugin-extension shape.

### Risks
- **R1 — Module augmentation requires the file to be in the import graph.** Mitigation: including the plugin in `plugins/index.ts` (imported by `api-client.ts`, `root.route.tsx`, and `app-shell.tsx`) guarantees the file is loaded.
- **R2 — Plugin route precedence.** React Router resolves by path specificity, not array position. A plugin declaring the same exact path as a core route can override it (last child wins for ambiguous matches). Mitigation: documented in the merge-site comment; revisit only if a real plugin needs override semantics.
- **R3 — Mock client surface drift.** Tests using `createMockApiClient({ allegro: { … } })` rely on caller overrides winning over plugin contributions. Mitigation: Step 6 spells out the merge order (`core → plugin → caller override`) and a Step 13 test pins it.
- **R4 — Circular import between `plugins/index.ts` and `app/api/api-client.ts`.** The api-client imports `plugins` to iterate them; each plugin file imports types from `app/api/api-client` for `ApiRequest` and to declaration-merge `PluginApiNamespaces`. Mitigation: those `app/api/api-client` references use `import type` (TS-only, no runtime cycle).
- **R5 — `@typescript-eslint/no-empty-interface` flags `interface PluginApiNamespaces {}`.** Mitigation: inline `eslint-disable-next-line @typescript-eslint/no-empty-interface -- canonical declaration-merging seam; plugins extend via 'declare module'` on the interface and on each plugin's augmentation block.

### Edge cases
- **Plugin with empty slots** — handled: `plugin.routes ?? []`, `plugin.navItems ?? []`, `plugin.apiNamespaces?.(request) ?? {}`.
- **Two plugins contributing the same `groupLabel`** — both append to the same group in registry order. Documented.
- **Two plugins contributing the same API namespace key** — last-write-wins (`Object.assign`). Acceptable for MVP; a future runtime-aware version can throw on conflict.
- **Two plugins sharing the same `id`** — boot-time assertion throws. Covered by Step 13.

### Backward compatibility
- ✅ Every existing route, API call, and nav item continues to render identically.
- ✅ `ApiClient` stays structurally identical at every consumer site (Core + augmented Plugin = the same 16 namespaces in the running app).
- ✅ No data migration; no API surface change to the backend.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests
- `apps/web/src/plugins/plugin-registry.test.ts` — composition of all three extension points using fixture plugins, mock merge-order, and id-uniqueness assertion.
- `apps/web/src/plugins/allegro/allegro-plugin.test.ts` — smoke test that `allegroPlugin` exposes the expected `routes` and `apiNamespaces`.
- Existing `*.test.tsx` files using `createMockApiClient({ allegro: { … } })` continue to pass without modification.

### Integration tests
- N/A for FE — Vitest + Testing Library is the FE equivalent.

### Mocking strategy
- Real `createApiClient` is used in tests where the `request` function is stubbed. Fixture plugins are built inline. No networked code under test.

### Acceptance criteria
- [ ] `apps/web/src/plugins/{plugin.types.ts, define-plugin.ts, merge-nav-contributions.ts, index.ts, allegro/index.ts, allegro/allegro-callback.route.tsx, allegro/allegro-setup.route.tsx, prestashop/index.ts, prestashop/prestashop-setup.route.tsx}` exist and compile.
- [ ] `ApiClient = CoreApiClient & PluginApiNamespaces`; the explicit `allegro` field is gone from `CoreApiClient`.
- [ ] `apiClient.allegro.startOAuth(...)` type-checks at every call site and works at runtime exactly as before.
- [ ] `root.route.tsx` no longer explicitly imports `allegroCallbackRoute`, `allegroSetupRoute`, or `prestashopSetupRoute`; those routes are contributed by the respective plugins.
- [ ] `apps/web/src/app/routes/allegro-callback.route.tsx`, `allegro-setup.route.tsx`, `prestashop-setup.route.tsx` no longer exist (relocated into `plugins/`).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all green.
- [ ] All Vitest cases in `plugin-registry.test.ts` and `allegro-plugin.test.ts` pass.
- [ ] `.eslintrc.js` rejects a `plugins/` file that imports from `app/router` or any other non-public `app/` path.
- [ ] `docs/frontend-architecture.md` documents `plugins/` in Folder Conventions and Dependency Rules.
- [ ] FE smoke (browser): `/`, `/connections/new/allegro`, `/connections/new/prestashop`, `/integrations/allegro/connect/callback` all render without console errors.
- [ ] No `any` introduced; no `console.log`; no `eslint-disable` without an inline rationale.

---

## 10. Alignment Checklist

- [x] Follows the architecture documented in `docs/frontend-architecture.md` (and updates the doc to reflect the new boundary)
- [x] Respects `app → pages → features → shared`; adds `plugins/` as a new boundary with explicit, lint-enforced dependency direction
- [x] Uses existing patterns (`*.api.ts` factories, `RouteObject` route modules, identity-fn helpers)
- [x] Idempotent at build time (plugin barrel is a const array)
- [x] No event-driven concerns (frontend)
- [x] No backend rate-limit / retry concerns
- [x] Error handling: registry merge is total; id-uniqueness throws at load
- [x] Testing strategy complete (Vitest unit tests for registry + plugin wiring + browser smoke)
- [x] Naming conventions followed
- [x] File structure matches existing FE conventions + new documented `plugins/` boundary
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## Related Documentation
- `docs/frontend-architecture.md` — FE folder structure, dependency rules, ApiClient conventions (updated as part of this PR)
- `docs/engineering-standards.md` — file headers, type separation, naming, error handling
- `docs/architecture-overview.md` §10 — BE `PluginRegistryModule` reference (the shape this plan mirrors)
- Issue #604 — H1 BLOCKER: No FE plugin/extension registry
- Issue #605 — H2 BLOCKER: Typed `ApiClient` is a closed enum
- PR #572 (merged) — backend `PluginRegistryModule.forRoot({ plugins })`
