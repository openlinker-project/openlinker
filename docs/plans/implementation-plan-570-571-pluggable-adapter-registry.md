# Implementation Plan — #570 + #571 Pluggable adapter registry

## 1. Goal

Close two BLOCKER findings from Modularity Thread C:

- **#570** — `AdapterRegistryService` is a hardcoded inline `Map` literal. No
  `register()` method, no DB backing, no manifest discovery. An out-of-tree
  plugin (e.g. `@third-party/openlinker-plugin-shopify`) cannot register
  itself; even an in-tree contributor must edit `libs/core` to add a
  platform.
- **#571** — `IntegrationsService.deriveAdapterKey` carries a private
  `Record<platformType, adapterKey>` that hardcodes `'prestashop' →
  'prestashop.webservice.v1'` and `'allegro' → 'allegro.publicapi.v1'`. Any
  new platform requires editing core.

The asymmetry between these two registries and the already-pluggable
`AdapterFactoryResolverService` (which has `registerFactory(...)` and is
populated by `*IntegrationModule.onModuleInit()`) is the bug. After this
change, all three artefacts an integration contributes — metadata, factory,
and platform default — are registered the same way, by the integration
module itself.

Layer: **CORE infrastructure + Integration self-registration**.
Non-goals (left for follow-up tickets):
- #574 Placeholder `getAdapter` return shape — keep as-is.
- #575 Static manifest export from adapter packages — separate ticket.
- DB-backed registry — defer to when a real use case lands.
- Capability open-union (#576) and EntityType open-union (#577) — separate
  tickets in the same epic.

## 2. Design

### 2.1 Port surface — `AdapterRegistryPort`

Add **two** new methods, sized to mirror `AdapterFactoryResolverService`:

```typescript
export interface AdapterRegistryPort {
  /** Existing — unchanged. */
  getAdapter(adapterKey: string): Promise<AdapterInstance>;
  getAdapterMetadata(adapterKey: string): Promise<AdapterMetadata>;
  listAdapters(): Promise<AdapterMetadata[]>;

  /**
   * Register an adapter's metadata (#570).
   *
   * Sync (returns `void`) — deliberately mirrors the sister
   * `AdapterFactoryResolverService.registerFactory` so contributors
   * can reason about both registries the same way at boot time. The
   * read-side methods above stay async because they may grow IO
   * (DB-backed registry) in the future; registration is in-process.
   *
   * Throws `DuplicateAdapterKeyException` if `adapterKey` is already
   * registered (loud-fail per `code-review-guide.md` "fail fast on
   * configuration errors"). If `metadata.isDefault === true`, also
   * registers the adapter as the platform default — throws
   * `DuplicatePlatformDefaultException` if another adapter is already
   * the default for the same `platformType`.
   */
  register(metadata: AdapterMetadata): void;

  /**
   * Resolve the default adapterKey for a platformType (#571).
   * Replaces `IntegrationsService.deriveAdapterKey`. Async to match
   * the read-side methods above. Throws `AdapterNotFoundException`
   * if no default is registered for the platformType.
   */
  getDefaultAdapterKey(platformType: string): Promise<string>;
}
```

**Domain exceptions** (`libs/core/src/integrations/domain/exceptions/`):

- `DuplicateAdapterKeyException` — extends `Error`, named per the existing `AdapterNotFoundException` / `CapabilityNotSupportedException` shape in the same directory.
- `DuplicatePlatformDefaultException` — same.

Per `engineering-standards.md` §Error Handling, every integrations-bounded-context error is a typed domain exception under `domain/exceptions/`; plain `throw new Error(...)` would break that convention.

### 2.2 `AdapterMetadata` — add optional `isDefault`

```typescript
// libs/core/src/integrations/domain/types/adapter.types.ts
export interface AdapterMetadata {
  adapterKey: string;
  platformType: string;
  supportedCapabilities: Capability[];
  displayName?: string;
  version?: string;
  /**
   * When true, this adapter is the default for its platformType — i.e.
   * `IntegrationsService` resolves an unspecified `connection.adapterKey`
   * to this adapter's key. At most one default per platformType is
   * permitted; the registry rejects a second default registration.
   */
  isDefault?: boolean;
}
```

This field is the simpler half of #571's recommendation: "register an
`isDefault: true` flag on `register()`, or expose
`registerPlatformDefault(platformType, adapterKey)`". The flag wins
because it keeps registration to a single call.

### 2.3 `AdapterRegistryService` — rewrite

```typescript
@Injectable()
export class AdapterRegistryService implements AdapterRegistryPort {
  private readonly logger = new Logger(AdapterRegistryService.name);
  private readonly registry = new Map<string, AdapterMetadata>();
  private readonly defaultsByPlatform = new Map<string, string>();

  register(metadata: AdapterMetadata): void {
    if (this.registry.has(metadata.adapterKey)) {
      throw new DuplicateAdapterKeyException(metadata.adapterKey);
    }
    if (metadata.isDefault === true) {
      const existing = this.defaultsByPlatform.get(metadata.platformType);
      if (existing) {
        throw new DuplicatePlatformDefaultException(
          metadata.platformType,
          existing,
          metadata.adapterKey,
        );
      }
      this.defaultsByPlatform.set(metadata.platformType, metadata.adapterKey);
    }
    this.registry.set(metadata.adapterKey, metadata);
    this.logger.log(`Registered adapter: ${metadata.adapterKey}` +
      (metadata.isDefault ? ` (default for ${metadata.platformType})` : ''));
  }

  async getDefaultAdapterKey(platformType: string): Promise<string> {
    const adapterKey = this.defaultsByPlatform.get(platformType);
    if (!adapterKey) {
      throw new AdapterNotFoundException(
        `No default adapter registered for platformType: ${platformType}. ` +
          `Available platforms: ${Array.from(this.defaultsByPlatform.keys()).join(', ')}`,
      );
    }
    return adapterKey;
  }

  // ... existing getAdapter / getAdapterMetadata / listAdapters unchanged
}
```

The inline metadata literal is **deleted** — empty registry on construct.

**File header update**: the existing JSDoc on `adapter-registry.service.ts:1-12`
describes the registry as "in-memory static registry... Future versions
may support dynamic registration." That sentence becomes false when the
literal is removed, so rewrite the header to describe the new shape:
"registry populated at boot by integration modules via `register()`,
replacing the previous static literal." Per `engineering-standards.md`
§File Headers, the header is part of the contract.

### 2.4 `IntegrationsService` — drop `deriveAdapterKey`

Three call sites currently call `this.deriveAdapterKey(...)`:
- `getAdapter()` line 70
- `resolveAdapterMetadata()` line 159
- `listCapabilityAdapters()` line 198

All three replaced with:

```typescript
const adapterKey = connection.adapterKey
  ?? await this.adapterRegistry.getDefaultAdapterKey(connection.platformType);
```

The private `deriveAdapterKey` method (lines 288–315) is **deleted**.

### 2.5 Integration modules self-register metadata

Both `AllegroIntegrationModule` and `PrestashopIntegrationModule` already
self-register their factory in `onModuleInit`. Add an
`AdapterRegistryService` injection and one `register({...})` call alongside
the existing `factoryResolver.registerFactory(...)`. Same call site, same
log line cluster — keeps the contributor mental model "everything an
integration registers, it does in `onModuleInit`".

```typescript
// AllegroIntegrationModule
constructor(
  @Inject(ADAPTER_REGISTRY_TOKEN)
  private readonly adapterRegistry: AdapterRegistryPort,
  // ...existing
) {}

onModuleInit(): void {
  this.adapterRegistry.register({
    adapterKey: 'allegro.publicapi.v1',
    platformType: 'allegro',
    supportedCapabilities: ['OrderSource', 'OfferManager'],
    displayName: 'Allegro Public API v1',
    version: '1.0.0',
    isDefault: true,
  });
  this.factoryResolver.registerFactory('allegro.publicapi.v1', factory);
  // ...existing
}
```

`PrestashopIntegrationModule` mirrors this with the prestashop metadata
that's currently inline in the service literal (capabilities `ProductMaster`,
`InventoryMaster`, `OrderSource`, `OrderProcessorManager`).

NestJS guarantees `onModuleInit` runs in import-graph order; both
integration modules import `IntegrationsModule` (which provides the
registry), so the registry is constructed before the integration tries to
register into it. Already validated empirically by the existing
`registerFactory` flow that uses the same shape.

## 3. Step-by-step

| # | File | Change | Acceptance |
|---|------|--------|------------|
| 1 | `libs/core/src/integrations/domain/types/adapter.types.ts` | Add optional `isDefault?: boolean` to `AdapterMetadata` | Type-checks |
| 2 | `libs/core/src/integrations/domain/ports/adapter-registry.port.ts` | Add `register()` + `getDefaultAdapterKey()` to interface | Type-checks |
| 3 | `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts` | Drop inline Map literal; implement `register()` + `getDefaultAdapterKey()` with duplicate guards | Empty-registry tests pass |
| 4 | `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.spec.ts` | Rewrite for empty-registry-with-register flow; cover register, duplicate, getDefault, duplicate-default, listAdapters | All new tests pass |
| 5 | `libs/core/src/integrations/application/services/integrations.service.ts` | Replace 3× `deriveAdapterKey(...)` with `await this.adapterRegistry.getDefaultAdapterKey(...)`; delete the private method | Lint clean; `IntegrationsService.spec` passes |
| 6 | `libs/core/src/integrations/application/services/integrations.service.spec.ts` | Add `getDefaultAdapterKey: jest.fn()` to mock; default mock to resolve `'prestashop.webservice.v1'`; ensure existing tests still cover the resolution path | Existing 30+ tests pass |
| 7 | `libs/integrations/allegro/src/allegro-integration.module.ts` | Inject `ADAPTER_REGISTRY_TOKEN`; call `adapterRegistry.register({ ..., isDefault: true })` in `onModuleInit` | Boot succeeds, `IntegrationsService.getAdapter('allegro-conn')` resolves |
| 8 | `libs/integrations/prestashop/src/prestashop-integration.module.ts` | Same pattern — register prestashop metadata in `onModuleInit` | Boot succeeds, `IntegrationsService.getAdapter('ps-conn')` resolves |
| 9 | `libs/core/src/integrations/domain/exceptions/duplicate-adapter-key.exception.ts` (new) + `duplicate-platform-default.exception.ts` (new) | Two domain exceptions following the existing `AdapterNotFoundException` shape | Compile clean; thrown from `register()` |
| 10 | `docs/architecture-overview.md:1149-1167` | Add one sentence: "Each integration module self-registers its adapter metadata via `adapterRegistry.register({...})` in `onModuleInit`." Closes the doc-vs-code drift this audit was meant to expose. | Doc reflects new wiring |
| 11 | (verify) | Existing api-app integration tests (`app-boot.int-spec.ts`, `connection-capabilities.int-spec.ts`) still pass | Both green |

## 4. Validation

### Architecture compliance

- ✅ CORE owns `AdapterRegistryService` + `AdapterRegistryPort`.
- ✅ Integrations only call the published port methods — no deep imports.
- ✅ `register()` is sync (mirrors `registerFactory`); `getDefaultAdapterKey`
  is async (mirrors `getAdapterMetadata`).
- ✅ No domain-layer changes (only types added).

### Naming

- `AdapterRegistryPort`, `AdapterRegistryService` — per
  `engineering-standards.md` "Ports vs Concrete Implementations".
- New port methods follow camelCase verb-first convention.

### Error handling

- Duplicate `adapterKey` registration: throw `Error` (configuration error,
  fail-fast at boot).
- Duplicate default per platformType: throw `Error` (same).
- Missing default for a connection's platformType: throw
  `AdapterNotFoundException` (existing domain exception, preserves the
  current `IntegrationsService.deriveAdapterKey` semantics).

### Testing strategy

- **Unit**: rewrite `adapter-registry.service.spec.ts` to construct a fresh
  empty registry and exercise `register` + `getDefaultAdapterKey`.
  Cover: register-then-get, duplicate adapterKey throws
  `DuplicateAdapterKeyException`, duplicate-default throws
  `DuplicatePlatformDefaultException`, getDefaultAdapterKey throws
  `AdapterNotFoundException` when unknown, listAdapters reflects
  registered set.
- **Unit**: extend `integrations.service.spec.ts` mock to include
  `getDefaultAdapterKey: jest.fn().mockResolvedValue('prestashop.webservice.v1')`.
  Existing 30+ tests carry forward unchanged because they pass
  `mockConnection` with no `adapterKey`, hitting the derive path — now
  via mock. Add **one** explicit assertion in a "no explicit adapterKey"
  test case: `expect(adapterRegistry.getDefaultAdapterKey).toHaveBeenCalledWith('prestashop')`
  — documents the contract a future contributor needs to preserve, since
  the implicit-via-mock coverage is invisible to anyone reading the test
  list.
- **Integration**: `app-boot.int-spec.ts` already boots the full Nest
  graph; if `onModuleInit` registration is broken, that spec fails at
  startup. No new int-spec needed for #570/#571 specifically.

### Security / blast radius

- Single boot path. If an integration module's `onModuleInit` throws
  (duplicate registration or similar), the API/worker fails to boot at
  startup with a precise error message — same fail-mode as today's
  `registerFactory` would have, just on a different line.
- No data migration; no schema change.

## 5. Risks & open questions

- **Boot-time ordering across multiple workers/processes**: registration
  is in-process. Each NestJS process registers independently at boot —
  same as today. No coordination needed.
- **Tests that previously relied on the live registry implicitly returning
  `prestashop.webservice.v1` and `allegro.publicapi.v1`**: any
  unit test that constructs `AdapterRegistryService` directly without
  registering anything will see an empty registry. The only such test is
  `adapter-registry.service.spec.ts`, which we're rewriting.
- **Future `register()` ordering between metadata and factory**: today the
  module registers factory first, then connection-tester. After this
  change, also metadata. Order doesn't matter — the registry and the
  factory resolver are independent maps. Adopt convention "metadata →
  factory → tester" for readability; document as a comment in the first
  module.
