# Implementation Plan — Adapter Registry Type Safety (#573 + #574 + #575)

**Branch:** `573-574-575-adapter-registry-type-safety`
**Parent issues:** [#549 Modularity Thread C](https://github.com/SilkSoftwareHouse/openlinker/issues/549), [#546 Epic](https://github.com/SilkSoftwareHouse/openlinker/issues/546)
**Issues:** [#573](https://github.com/SilkSoftwareHouse/openlinker/issues/573), [#574](https://github.com/SilkSoftwareHouse/openlinker/issues/574), [#575](https://github.com/SilkSoftwareHouse/openlinker/issues/575)

---

## 1. Goal

Three adjacent tech-debt items in the adapter registry / plugin contract surface that #649 partially modernised but did not fully clean up:

- **#573** — **Consolidate** the `as unknown as T` cast in `AdapterPlugin.createCapabilityAdapter<T>` switch bodies into a single SDK seam. Today both `allegro-plugin.ts` and `prestashop-plugin.ts` carry a `switch (capability)` with one `as unknown as T` per case — 6 casts across 2 plugins. The cast itself cannot be **eliminated** because `supportedCapabilities` is an open string set (`adapter.types.ts:50-72`, #576) — declaration-merged closed maps don't survive the runtime registration semantics — so true compile-time enforcement between `capability` and `T` is structurally blocked at this layer. What we *can* do is collapse 6 occurrences into 1, in a helper plugin authors don't write themselves.
- **#574** — Delete the `AdapterRegistryService.getAdapter()` placeholder that returns `{ adapterKey } as AdapterInstance` (where `AdapterInstance = unknown`). It exists only because the factory path bypasses it; no production consumer reads the result. Confusing dual-path code that lets a plugin silently succeed with a fake adapter object.
- **#575** — Expose `AdapterMetadata` as a static export from each adapter package so the host can read the manifest **without** booting Nest. Today the manifest only exists inside the runtime return of `createAllegroPlugin(deps)`.

**Layer:** CORE (`libs/core/src/integrations`) + SDK (`libs/plugin-sdk`) + both integration packages.

---

## 2. Non-goals

- No change to `AdapterFactoryPort.createCapabilityAdapter<T>` signature on the **resolver service** — the resolver is a Nest seam and rewriting its public type to a typed capability map ripples into every internal caller. The `as unknown as T` lives in plugin authoring; that's where the fix lands.
- No runtime plugin loading (#F6 / future epic). Static-manifest export is a precondition, but the consumer (e.g. CLI manifest-diff tool, capability-matrix dashboard) is out of scope.
- No change to which capabilities exist or how they're declared on the connection entity.

---

## 3. Current state (verified post-#649)

```
libs/plugin-sdk/src/adapter-plugin.ts          — AdapterPlugin.createCapabilityAdapter<T>(...) → Promise<T>
libs/integrations/allegro/src/allegro-plugin.ts:106-117       — switch + 2× `as unknown as T`
libs/integrations/prestashop/src/prestashop-plugin.ts:92-112  — switch + 4× `as unknown as T`
libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts:60-65
  — getAdapter() returns `{ adapterKey } as AdapterInstance`
libs/core/src/integrations/application/services/integrations.service.ts
  :52-89  — getAdapter() returns { connection, adapter, metadata }
  :146-152 + :228-247 — placeholder-fallback branches
libs/core/src/integrations/domain/types/adapter.types.ts:100 — `export type AdapterInstance = unknown`
```

**Verified:** no production consumer of `IntegrationsService.getAdapter()` reads `.adapter`. All three callers (`auto-match-variant-offers.service.ts`, `offer-mapping-sync.service.ts`, `apps/api/src/integrations/application/services/connection.service.ts`) destructure only `connection` and/or `metadata`. The placeholder branch is dead in production for `getAdapter`.

**Also verified:** the placeholder-fallback branches inside `getCapabilityAdapter` (lines 131–143) and `listCapabilityAdapters` (lines 227–246) are unreachable in production today. Both branches activate only when `factoryResolver.hasFactory(adapterKey)` is false OR `factoryResolver.createCapabilityAdapter` throws `AdapterNotFoundException`. Every in-tree integration ships a registered factory alongside its `manifest`:

- `allegro-integration.module.ts:171-178` registers a factory wrapping `createAllegroPlugin(...)` via `factoryResolver.registerFactory('allegro.publicapi.v1', ...)`.
- `prestashop-integration.module.ts:149-156` does the same for `'prestashop.webservice.v1'`.

So today every metadata-registered `adapterKey` also has a factory. Removing the fallback changes behaviour **only** for a future broken state: a plugin author registers `manifest` but forgets the factory. Today's runtime path is unaffected. The behaviour change is from "you got `{ adapterKey } as T` and crashed on the first method call" → "you got `AdapterNotFoundException` synchronously" — both are errors, the new one is louder and earlier. In `listCapabilityAdapters` the existing outer try/catch at lines 270–279 already catches `AdapterNotFoundException` and `continue`s the loop, so a missing factory in a list-shaped call degrades gracefully to "skip this connection."

**External public surface:** `AdapterInstance` is re-exported from `libs/core/src/integrations/index.ts` but the only off-context consumer is the integrations service spec — safe to remove from the barrel.

---

## 4. Design

### 4.1 Static manifest (#575)

Extract each plugin's manifest literal to a standalone `const`. **Naming note:** the audit's literal wording was `export const manifest: AdapterMetadata`, but a bare `manifest` from two integration packages would collide for any consumer importing both (a manifest-diff CLI, a capability-matrix dashboard) — so we prefix: `allegroAdapterManifest` / `prestashopAdapterManifest`. The audit's contract intent is preserved; the name disambiguates at the import site.

```ts
// libs/integrations/allegro/src/allegro-plugin.ts
export const allegroAdapterManifest: AdapterMetadata = {
  adapterKey: 'allegro.publicapi.v1',
  platformType: 'allegro',
  supportedCapabilities: ['OrderSource', 'OfferManager'],
  displayName: 'Allegro Public API v1',
  version: '1.0.0',
  isDefault: true,
};

export function createAllegroPlugin(deps: CreateAllegroPluginDeps): AdapterPlugin {
  return { manifest: allegroAdapterManifest, register(...) {...}, createCapabilityAdapter(...) {...} };
}
```

Re-export from each package's `index.ts` barrel:

```ts
// libs/integrations/allegro/src/index.ts
export { createAllegroPlugin, allegroAdapterManifest, type CreateAllegroPluginDeps } from './allegro-plugin';
```

The runtime plugin object continues to carry `manifest` (same reference); nothing about the runtime path changes.

### 4.2 Type-safe capability dispatch (#573)

Add a tiny SDK helper that drops the `as unknown as T` cast at the seam where it appears:

```ts
// libs/plugin-sdk/src/dispatch-capability.ts
/**
 * Dispatch a capability name to a typed factory function. The cast lives
 * once, in this helper — plugin authors declare the dispatch table as a
 * typed record with no per-case casts.
 */
export function dispatchCapability<T>(
  capability: string,
  table: Record<string, () => unknown>,
  pluginName: string,
): T {
  const factory = table[capability];
  if (!factory) {
    throw new Error(
      `${pluginName} adapter does not support capability: ${capability}. ` +
        `Supported capabilities: ${Object.keys(table).join(', ')}`,
    );
  }
  return factory() as T;
}
```

Plugins consume it:

```ts
// allegro-plugin.ts (after)
async createCapabilityAdapter<T>(connection, capability, host): Promise<T> {
  const adapters = await new AllegroAdapterFactory(...).createAdapters(connection, host.identifierMapping, host.credentialsResolver);
  return dispatchCapability<T>(capability, {
    OfferManager: () => adapters.offerManager,
    OrderSource: () => adapters.orderSource,
  }, 'Allegro');
}
```

The single `as T` inside the helper is honest — the plugin author's contract is "if you list `OfferManager` in your dispatch table and `T = OfferManagerPort`, that's on you to keep aligned." The win is that the cast lives in **one place** rather than 6 across two plugins, and plugin authors no longer write `as unknown as T` boilerplate.

**Alternative considered:** a generic `CapabilityMap<TMap>` interface with literal-keyed factories typed by capability. Discarded because the resolver service still takes `<T>` as a generic with no link to `capability: string` — the type-level link can't actually flow across the resolver seam without rewriting it (out of scope per § 2). The helper is the right size for the problem.

### 4.3 Kill the placeholder (#574)

1. **Port:** remove `AdapterRegistryPort.getAdapter`.
2. **Service:** remove `AdapterRegistryService.getAdapter` implementation.
3. **Types:** remove `AdapterInstance` from `adapter.types.ts` and its export from `libs/core/src/integrations/index.ts`.
4. **IntegrationsService.getAdapter:** return shape becomes `{ connection: Connection; metadata: AdapterMetadata }` — drop the `adapter` field. The 3 production callers destructure only what they already use.
5. **IntegrationsService.getCapabilityAdapter:** delete the `AdapterNotFoundException` → "fall back to placeholder" branch (lines 131–143). If a factory isn't registered for a `metadata.adapterKey`, throw — operator either forgot to install the plugin module or misconfigured the connection.
6. **IntegrationsService.listCapabilityAdapters:** same deletion at lines 224–246; the `factoryResolver.hasFactory` check + the `AdapterNotFoundException` fallback path both go. If a factory is missing, skip the connection (continue the loop) instead of yielding a placeholder.
7. **Spec:** update `integrations.service.spec.ts` — the placeholder paths have dedicated tests; convert them to "throws when factory missing" assertions.

---

## 5. Step-by-step

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/allegro-plugin.ts` | Extract `manifest` literal to `export const allegroAdapterManifest` | Spec / type-check unchanged |
| 2 | `libs/integrations/prestashop/src/prestashop-plugin.ts` | Same — `prestashopAdapterManifest` | Spec / type-check unchanged |
| 3 | `libs/integrations/allegro/src/index.ts` + `libs/integrations/prestashop/src/index.ts` | Re-export the static manifest | Type-check passes; barrels gain one symbol each |
| 4 | `libs/plugin-sdk/src/dispatch-capability.ts` (new) | Add `dispatchCapability<T>` helper | New unit spec covers happy / unknown-capability paths |
| 5 | `libs/plugin-sdk/src/index.ts` | Export `dispatchCapability` | Type-check passes |
| 6 | `libs/integrations/allegro/src/allegro-plugin.ts` | Replace switch in `createCapabilityAdapter` with `dispatchCapability` | No `as unknown as T` left in file; all integration tests pass |
| 7 | `libs/integrations/prestashop/src/prestashop-plugin.ts` | Same | No `as unknown as T` left in file; OrderProcessorManager null-guard remains as explicit throw |
| 8 | `libs/core/src/integrations/domain/ports/adapter-registry.port.ts` | Remove `getAdapter` method from interface | Spec / type-check |
| 9 | `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts` | Remove `getAdapter` implementation + `AdapterInstance` import | Spec / type-check |
| 10 | `libs/core/src/integrations/domain/types/adapter.types.ts` | Remove `AdapterInstance` type | Type-check |
| 11 | `libs/core/src/integrations/index.ts` | Remove `AdapterInstance` from public barrel | Type-check; no off-context consumer |
| 12 | `libs/core/src/integrations/application/interfaces/integrations.service.interface.ts` | `getAdapter` return shape loses `adapter` field; `AdapterInstance` import dropped | Type-check |
| 13 | `libs/core/src/integrations/application/services/integrations.service.ts` | Drop `adapter` from `getAdapter` return; remove placeholder fallback branches in `getCapabilityAdapter` + `listCapabilityAdapters`; let `AdapterNotFoundException` propagate | All consumer specs pass |
| 14 | `libs/core/src/integrations/application/services/integrations.service.spec.ts` | Update tests: remove placeholder-fallback assertions, add "throws when factory missing" assertions, update `getAdapter` return-shape assertions | All cases green |
| 15 | `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.spec.ts` | Remove `getAdapter` test cases | Suite green |
| 16 | `libs/plugin-sdk/src/dispatch-capability.spec.ts` (new) | Unit-test the helper: known capability → factory fired AND its return value is returned (not discarded); unknown → throws with adapter name in message; lists supported capabilities in the error message | Spec green |
| 17 | `docs/architecture-overview.md` § 10 "Plugin Manager / Integrations" | One-paragraph addition documenting the static `manifest` export as part of the public plugin contract (audit recommendation in #575). Reference `allegroAdapterManifest` as the example. | Doc reflects the new seam |

---

## 6. Quality gate

```bash
pnpm lint        # zero new warnings; existing warnings unchanged
pnpm type-check  # zero errors
pnpm test        # ~2,769 unit tests, web on 991, all green
```

No DB migrations. No FE changes. No `apps/web` impact.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| The placeholder-fallback branches are load-bearing for some boot-time path I haven't traced | Verified at grep: all 3 production callers destructure only `connection`/`metadata`. Specs covered the branches but the runtime behaviour they describe is "fake adapter object goes to caller who doesn't use it." |
| Removing `AdapterInstance` from the public barrel breaks an external consumer | Verified at grep: only consumer outside core/integrations is the spec file in same directory. Safe. |
| `dispatchCapability` is over-engineering for 2 plugins | It deletes 6 `as unknown as T` casts and lives in <30 lines including JSDoc. Equivalent local helpers in plugin files would still be 2× the boilerplate. The seam is in the SDK because plugin authors are the audience. |
| Tests that mocked `adapterRegistry.getAdapter` will break | They're in the same package as the change — updating them is part of Step 14. |
| `AdapterRegistryPort.getAdapter` removal is a port-level contract change | Domain ports in `domain/ports/` are public contracts. Removing a method is a deliberate narrowing. Mitigated by: same PR, same file, no off-context consumers (verified at grep). |

---

## 8. Open questions

None. The recommendations in each issue are unambiguous and the file paths verified post-#649.
