# Implementation plan — #702 Unify WebPlugin + PlatformPlugin

**Layer**: Frontend / Plugin contract
**Severity**: LOW (Modularity Thread H follow-up; #554)
**Issue**: #702

## Problem

`apps/web/` carries two parallel manifests under the same vocabulary:

- `WebPlugin` (`apps/web/src/plugins/plugin.types.ts`) — build-time host composition: `routes`, `navItems`, `apiNamespaces`, `offerCreationWizard`. Collected as `plugins: WebPlugin[]`.
- `PlatformPlugin` (`apps/web/src/shared/plugins/plugin.types.ts`) — runtime per-platform UI: `setupCard`, `StructuredConfigSection`, `ExtraConfigSection`, `CredentialsPanel`, `ConnectionActions`, `extractContentPublishErrors`, etc. Collected as `IN_TREE_PLUGINS: readonly PlatformPlugin[]`.

Every in-tree plugin contributes to both. `WebPlugin.id` and `PlatformPlugin.platformType` are not invariant-linked — drift is a latent bug. The barrel spends 16 lines explaining why two parallel manifests coexist; that defensive prose is the primary smell.

## Goal

One `OpenLinkerPlugin` shape with namespaced sub-contributions for the two lifecycles:

```ts
export interface BuildContribution {
  routes?: RouteObject[];
  navItems?: NavContribution[];
  apiNamespaces?: PluginApiNamespacesFactory;
  offerCreationWizard?: OfferCreationWizardContribution;
}

export interface PlatformContribution {
  displayName: string;
  setupCard?: PlatformSetupCard;
  requiresExternalAuthRedirect?: boolean;
  getCallbackUrlDefault?: () => string | undefined;
  StructuredConfigSection?: ComponentType<StructuredConfigSectionProps>;
  ExtraConfigSection?: ComponentType<ExtraConfigSectionProps>;
  CredentialsPanel?: ComponentType<{ connection: Connection }>;
  ConnectionActions?: ComponentType<{ connection: Connection }>;
  supportsListingEdit?: boolean;
  extractContentPublishErrors?: (err: unknown) => StructuredError[] | null;
}

export interface OpenLinkerPlugin {
  id: string;
  platformType?: string;             // present iff `platform` is present
  build?: BuildContribution;
  platform?: PlatformContribution;
}
```

Resolution stays mechanically the same:

- **Build-time** (iterated by router / nav / api-client): `plugins.flatMap(p => p.build?.X ?? [])`.
- **Runtime** (iterated via React context): `usePlugin(target)` returns `{ platformType, ...plugin.platform }` for the matching plugin — a `PlatformView` shape that preserves every field today's `PlatformPlugin` consumers access (`p.setupCard`, `p.platformType`, etc.). **Zero call-site edits** in features/pages — same shape as before.

One array: `plugins: OpenLinkerPlugin[]` in `apps/web/src/plugins/index.ts`. `IN_TREE_PLUGINS` deleted.

## Non-goals

- Backend `PluginEntry` / `AdapterPlugin` (#572/#593) — out of scope.
- Generic-third-party-plugin design — still in-tree-only.

## Hook rename (in scope)

`usePlugin` / `usePlugins` were ambiguous between "the plugin object" and "the platform-side view". After unification they're specifically the platform-side view (the `Platform` shape). Renaming to `usePlatform` / `usePlatforms` clarifies the contract.

- `usePlatform(platformType)` returns `Platform | undefined` where `Platform = { platformType: string } & PlatformContribution`.
- `usePlatforms()` returns `readonly Platform[]`.
- 13 call-site files need the rename. Each is a one-line import + one-line invocation update.

## Layer

Frontend. No backend / no migrations.

## File changes

### 1. Unified types — single source

Move all plugin contract types to `apps/web/src/shared/plugins/plugin.types.ts`:
- New: `OpenLinkerPlugin`, `BuildContribution`, `PlatformContribution`, `PlatformView`.
- Migrated from `apps/web/src/plugins/plugin.types.ts`: `NavContribution`, `PluginApiNamespacesFactory`, `OfferCreationWizardProps`, `OfferCreationWizardContribution`.
- Removed: `WebPlugin`, `PlatformPlugin` (deleted; old names are gone, ESLint guard blocks reintroduction).

`shared/plugins/` already type-imports `Connection` + `EditConnectionFormValues` from `features/connections/` under a documented exemption. The unified file also needs `Role` from `app/nav-registry.types`. Extend the lint exemption with `Role` as a type-only import.

### 2. Per-plugin merge

Allegro:
- Merge `apps/web/src/plugins/allegro/index.ts` (WebPlugin) + `apps/web/src/plugins/allegro/allegro.plugin.tsx` (PlatformPlugin) into one file: `apps/web/src/plugins/allegro/index.ts` (kept `.ts` — no JSX literals in the manifest itself, only component references).
- Delete `apps/web/src/plugins/allegro/allegro.plugin.tsx`.
- The `declare module '../../app/api/api-client'` block (PluginApiNamespaces declaration-merge) moves with the unified manifest — same import-graph guarantee.

PrestaShop: same shape — merge `index.ts` + `prestashop.plugin.tsx` → `index.ts`; delete the `.plugin.tsx`.

### 3. Registry barrel

`apps/web/src/plugins/index.ts`:
- Single `plugins: OpenLinkerPlugin[]` array. Order: `[prestashopPlugin, allegroPlugin]` (preserves today's `IN_TREE_PLUGINS` UI order).
- Drop `IN_TREE_PLUGINS` and its assertion helper.
- `assertUniquePluginIds` extended to also assert unique `platformType` across plugins that declare one. Function renamed to `assertUniquePluginInvariants` (or kept and extended — TBD on naming).

### 4. Build-time consumer rewrites

Each site flips from a flat field access to a `build?.` chain:

- `apps/web/src/app/api/api-client.ts:206-207` → `plugin.build?.apiNamespaces?.(request)`
- `apps/web/src/app/nav-registry.ts:102` → `plugin.build?.navItems`
- `apps/web/src/app/routes/root.route.tsx:74` → `plugin.build?.routes`
- `apps/web/src/app/routes/route-lazy.test.ts:42` → `plugin.build?.routes`
- `apps/web/src/app/routes/route-handle.test.ts:60` → `plugin.build?.routes`
- `apps/web/src/plugins/resolve-offer-creation-wizard.ts:23` → `plugin.build?.offerCreationWizard`

### 5. Runtime hooks

`apps/web/src/shared/plugins/use-plugin.ts`:
```ts
export function usePlugin(platformType: string | undefined): PlatformView | undefined {
  const plugins = usePlugins();
  if (!platformType) return undefined;
  const plugin = plugins.find((p) => p.platformType === platformType);
  if (!plugin?.platform) return undefined;
  return { platformType: plugin.platformType!, ...plugin.platform };
}
```

`apps/web/src/shared/plugins/use-plugins.ts`:
```ts
export function usePlugins(): readonly PlatformView[] {
  const ctx = useContext(PluginRegistryContext);
  if (ctx === null) throw new Error('usePlugins() must be used inside <PluginRegistryProvider>.');
  return ctx;  // pre-flattened by the provider
}
```

`apps/web/src/shared/plugins/plugin-registry-context.tsx`:
- Context value type: `readonly PlatformView[]` (pre-flattened in the provider — one allocation per provider mount, not per `usePlugins()` call).
- Provider accepts `plugins: readonly OpenLinkerPlugin[]` and flattens internally.

### 6. App provider

`apps/web/src/app/providers/app-providers.tsx` — pass `plugins` instead of `IN_TREE_PLUGINS`.

### 7. Test infrastructure

`apps/web/src/test/test-utils.tsx` — change `plugins?: readonly PlatformPlugin[]` to `plugins?: readonly OpenLinkerPlugin[]`. Default: `IN_TREE_PLUGINS` → `plugins` (the new unified array).

### 8. ESLint guards

Add `no-restricted-imports` patterns in `.eslintrc.js`:
- Ban `WebPlugin`, `PlatformPlugin`, `IN_TREE_PLUGINS`, `allegroPlatformPlugin`, `prestashopPlatformPlugin` as named imports from anywhere — prevents reintroduction. (Alternative: just delete the symbols; ESLint catches via the missing-export error path. Add explicit ban for clarity.)
- Extend `shared/plugins/**` exemption to allow type-only `Role` import from `app/nav-registry.types`.

### 9. Tests

Update every test file referencing the old names:
- `apps/web/src/plugins/plugin-registry.test.ts` (existing test for `createMockApiClient`)
- `apps/web/src/plugins/allegro/allegro.plugin.test.tsx` → fold into a single allegro plugin test
- `apps/web/src/plugins/allegro/allegro-plugin.test.ts` (currently asserts WebPlugin shape)
- `apps/web/src/plugins/prestashop/prestashop.plugin.test.tsx`
- `apps/web/src/plugins/resolve-offer-creation-wizard.test.ts`
- `apps/web/src/shared/plugins/plugin-registry-context.test.tsx`
- `apps/web/src/features/connections/components/platform-picker.test.tsx`
- `apps/web/src/features/content/lib/extract-platform-errors.test.ts`

Each is a mechanical type-name update; the test logic should not change.

### 10. Documentation

Update `docs/frontend-architecture.md` — replace the "Platform Plugins (`plugins/`)" section's "two parallel concerns" prose with the unified shape.

## Acceptance criteria

- Single `OpenLinkerPlugin` interface; `WebPlugin` / `PlatformPlugin` symbols deleted from the value surface.
- Single `plugins: OpenLinkerPlugin[]` array; `IN_TREE_PLUGINS` deleted.
- One file per in-tree plugin (Allegro, PrestaShop) — no separate `*.plugin.tsx` siblings.
- The old identifiers `WebPlugin` / `PlatformPlugin` / `IN_TREE_PLUGINS` do not appear in any TS *identifier position* (banned by `no-restricted-syntax` in `.eslintrc.js`). A small number of historical JSDoc-comment references are intentional and document the migration (matches the precedent #603 set for `usePlugin` → `usePlatform`).
- `pnpm lint` / `pnpm type-check` / `pnpm test` green.
- Every existing FE test continues to pass.

## Risks

- **30+ files touched**, but the change is mechanical: type-name updates + a flat field access becoming a `build?.` / `platform?.` chain. No behavior change.
- **Declaration-merge import-graph**: the allegro plugin's `declare module '../../app/api/api-client'` block must stay in a file the registry imports. Merged file stays in the import graph via `plugins/index.ts`. ✓
- **`*.mocks.ts` registry from #603** is unaffected — it's a separate seam.

## Estimated size

~25 files modified, 2 deleted. Net LOC change near zero (mechanical refactor).
