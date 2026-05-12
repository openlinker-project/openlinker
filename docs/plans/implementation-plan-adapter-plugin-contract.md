# Implementation Plan — Adapter Plugin Contract (#593, #597)

**Issues closed:** #593 [F6 HIGH] no zero-config plugin path · #597 [F10 MEDIUM] no dedicated `@openlinker/plugin-sdk` package
**Branch:** `593-adapter-plugin-contract`
**Parent epic:** #552 — Modularity Thread F (SDK boundary)

---

## 1. Goal & Non-Goals

### Goal

Today an integration plugin (e.g. `AllegroIntegrationModule`) is a NestJS module that imports `TypeOrmModule.forFeature(...)`, `ConfigModule`, `CustomersModule`, … and `@Inject`s six different Symbol tokens including `'REDIS_CLIENT'` and `CACHE_PORT_TOKEN`. An out-of-tree plugin author has to read `apps/api` source to learn which tokens they must provide and which modules must already be imported in the host. No contract describes this.

This PR introduces a **framework-neutral plugin contract** (`AdapterPlugin`) plus a NestJS-flavored helper (`createNestAdapterModule`) that produces a Nest module from the descriptor. The two in-tree per-connection plugins (Allegro, PrestaShop) are migrated to declare an `AdapterPlugin` descriptor; the existing `Module + OnModuleInit` shape becomes a thin host-wrapper produced by the helper.

Side effect — closes #597 by parking the contract in a new workspace package `@openlinker/plugin-sdk` (under `libs/plugin-sdk/`), giving plugin authors a single canonical import root.

### Non-Goals

- **AI plugin migration is out of scope.** `AiIntegrationModule` doesn't follow the per-connection-adapter pattern — it binds a process-wide `AiCompletionPort` and never touches `AdapterRegistryService` / `AdapterFactoryResolverService`. The issue specifically targets per-connection adapters. AI stays exactly as it is.
- **No changes to `AdapterFactoryPort`, `AdapterFactoryResolverService`, or `AdapterRegistryService`.** The plugin descriptor reuses these as the runtime substrate.
- **No changes to `apps/api/src/plugins.ts` / `apps/worker/src/plugins.ts`.** Those still list NestJS modules — `createNestAdapterModule(plugin)` returns a NestJS module, so the seam at the app level is invariant.
- **No npm publishing config for `@openlinker/plugin-sdk` in this PR.** Creating the workspace + barrel closes the structural part of #597; actual publishing config (`publishConfig`, registry credentials) belongs to a separate Thread F PR (#596 versioning + publish).
- **No promotion of plugin-specific ports to `HostServices`.** `CustomerIdentityResolverPort`, `CustomerProjectionRepositoryPort`, `IMappingConfigService`, `WebhookSecretProviderPort`, `IntegrationCredentialRepositoryPort` stay as cross-package imports the plugin handles via its own module's providers. `HostServices` is the **curated, framework-neutral** bag of services every plugin can rely on — see §3.

---

## 2. Current State (Research Findings)

### Registries each plugin self-registers against today

| Registry | Token | Allegro uses | PS uses |
|---|---|---|---|
| `AdapterRegistryService` | `ADAPTER_REGISTRY_TOKEN` | ✓ | ✓ |
| `AdapterFactoryResolverService` | `ADAPTER_FACTORY_RESOLVER_TOKEN` | ✓ | ✓ |
| `ConnectionTesterRegistryService` | `CONNECTION_TESTER_REGISTRY_TOKEN` | ✓ | ✓ |
| `EmailNormalizerRegistryService` | `EMAIL_NORMALIZER_REGISTRY_TOKEN` | ✓ | — |
| `RetryClassifierRegistryService` | `RETRY_CLASSIFIER_REGISTRY_TOKEN` | ✓ | — |
| `SchedulerTaskRegistryService` | `SCHEDULER_TASK_REGISTRY_TOKEN` | ✓ | — |
| `WebhookProvisioningRegistryService` | `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` | — | ✓ |

### Host-provided services each plugin reaches into today

| Service | Allegro | PS | Generic? |
|---|---|---|---|
| `LoggerPort` (`@openlinker/shared/logging`) | ✓ | ✓ | ✓ generic |
| `IdentifierMappingPort` | (via factory args) | (via factory args) | ✓ generic |
| `CredentialsResolverPort` | (via factory args) | (via factory args) | ✓ generic |
| `CachePort` (`CACHE_PORT_TOKEN`, optional) | ✓ | — | ✓ generic |
| `ConfigService` (`@nestjs/config`, optional) | ✓ | — | ✓ generic |
| `'REDIS_CLIENT'` (raw redis client) | ✓ | — | ✓ generic |
| `CustomerIdentityResolverPort` | ✓ | — | plugin-specific |
| `CustomerProjectionRepositoryPort` | — | ✓ | plugin-specific |
| `IMappingConfigService` | — | ✓ | plugin-specific |
| `WebhookSecretProviderPort` | — | ✓ | plugin-specific |
| `IntegrationCredentialRepositoryPort` | ✓ optional | — | plugin-specific |
| ORM entity registration (`TypeOrmModule.forFeature`) | ✓ | — | plugin-specific |

"Generic" = every plugin will plausibly need it; promote to `HostServices`. "Plugin-specific" = only some plugins; stays as a regular cross-package import the plugin's own module handles.

### Factory shape today

Both plugins implement `AdapterFactoryPort.createCapabilityAdapter(connection, capability, identifierMapping, credentialsResolver)`. Implementations are *thin wrappers* (`AllegroAdapterFactoryWrapper`, `PrestashopAdapterFactoryWrapper`) over a richer internal factory (`AllegroAdapterFactory`, `PrestashopAdapterFactory`) that takes additional plugin-specific deps via its constructor.

---

## 3. Design

### 3.1 The `AdapterPlugin` contract (framework-neutral)

```typescript
// libs/plugin-sdk/src/adapter-plugin.ts
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from './host-services';

export interface AdapterPlugin {
  /**
   * Static metadata. Drives runtime adapter resolution and (eventually)
   * static discovery via the `package.json` manifest registry pattern (#575).
   */
  readonly manifest: AdapterMetadata;

  /**
   * Imperative side-registrations against host registries beyond the base
   * `manifest` + `createCapabilityAdapter` pair: connection tester, retry
   * classifier, scheduler tasks, email normalizer, webhook provisioner, …
   *
   * The host calls this exactly once at boot, after binding `manifest` and
   * the factory. Optional — plugins that only register a base adapter +
   * factory can omit it.
   */
  register?(host: HostServices): void;

  /**
   * Create a per-connection capability-adapter instance. Mirrors the existing
   * `AdapterFactoryPort.createCapabilityAdapter` shape with `host` as a typed
   * bag instead of positional `identifierMapping` + `credentialsResolver`
   * arguments — this is the seam plugin authors implement.
   */
  createCapabilityAdapter<T>(
    connection: Connection,
    capability: string,
    host: HostServices,
  ): Promise<T>;
}
```

### 3.2 `HostServices` — curated, framework-neutral bag

```typescript
// libs/plugin-sdk/src/host-services.ts
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  AdapterRegistryPort,
  ConnectionTesterRegistryService,
  EmailNormalizerRegistryService,
  WebhookProvisioningRegistryService,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { AdapterFactoryResolverService } from '@openlinker/core/integrations';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type {
  RetryClassifierRegistryService,
  SchedulerTaskRegistryService,
} from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared';

/**
 * The bag of host-provided services every adapter plugin can rely on. Curated
 * intentionally — services that ALL future plugins will plausibly need (logger,
 * identifier mapping, credentials, cache) plus handles to every well-known
 * side registry. Plugin-specific ports (CustomerIdentityResolverPort,
 * CustomerProjectionRepositoryPort, etc.) are NOT in this bag — plugins still
 * import them directly via their own NestJS module's providers.
 */
export interface HostServices {
  // --- Generic input services ---
  readonly logger: (context: string) => LoggerPort;
  readonly identifierMapping: IdentifierMappingPort;
  readonly credentialsResolver: CredentialsResolverPort;

  /** Optional cache port (host-installed CachePort, e.g. Redis-backed). */
  readonly cache?: CachePort;

  // --- Adapter registries (the two core ones every plugin uses) ---
  readonly adapterRegistry: AdapterRegistryPort;
  readonly factoryResolver: AdapterFactoryResolverService;

  // --- Side registries (each plugin uses a subset) ---
  readonly connectionTesterRegistry: ConnectionTesterRegistryService;
  readonly emailNormalizerRegistry: EmailNormalizerRegistryService;
  readonly retryClassifierRegistry: RetryClassifierRegistryService;
  readonly schedulerTaskRegistry: SchedulerTaskRegistryService;
  readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService;
}
```

**On `eventPublisher` and `db` from the issue's recommendation:** neither is used by any current plugin's `OnModuleInit` (PS gets a `WebhookSecretProviderPort` — but that's higher-level than raw DB access; Allegro registers its own `TypeOrmModule.forFeature([AllegroQuantityCommandOrmEntity])` for its own table, not via a host-provided `db`). Conservative cut: defer both — when the first plugin needs a generic `db` or `eventPublisher` handle, add to `HostServices` and open a follow-up. This matches the user's request: "conservative sounds good, create a follow up issue if needed".

### 3.3 `createNestAdapterModule()` — the bridge

```typescript
// libs/plugin-sdk/src/create-nest-adapter-module.ts
import { DynamicModule, Provider } from '@nestjs/common';
import { AdapterPlugin } from './adapter-plugin';

export interface CreateNestAdapterModuleOptions {
  /** The plugin descriptor. */
  readonly plugin: AdapterPlugin;

  /**
   * Extra NestJS imports the plugin's own infrastructure needs (e.g.
   * `TypeOrmModule.forFeature([SomeOrmEntity])`, `CustomersModule`, …).
   * Composed verbatim into the generated module's `imports`.
   */
  readonly imports?: NonNullable<DynamicModule['imports']>;

  /** Extra NestJS providers the plugin needs. Composed verbatim. */
  readonly providers?: Provider[];

  /** Extra NestJS exports. Mirrors `DynamicModule.exports`. */
  readonly exports?: NonNullable<DynamicModule['exports']>;
}

/**
 * Produces a NestJS `DynamicModule` that wires the host's `HostServices`
 * out of DI, calls `plugin.register(host)`, and binds the plugin's
 * `createCapabilityAdapter` into `AdapterFactoryResolverService`.
 *
 * The generated module imports `IntegrationsModule` + `SyncModule` so all
 * registry tokens resolve, plus whatever extra imports the caller passes.
 * Returns `DynamicModule` to match the existing `AiIntegrationModule.register()`
 * pattern at `libs/integrations/ai/src/ai-integration.module.ts:55`.
 */
export function createNestAdapterModule(
  options: CreateNestAdapterModuleOptions,
): DynamicModule;
```

Internally the helper produces a `@Module({ ... })` class with an `OnModuleInit` that:

1. Resolves all `HostServices` fields from DI (one `@Inject(TOKEN)` per field).
2. Builds the `HostServices` object (`hostBag`).
3. Calls `hostBag.adapterRegistry.register(plugin.manifest)`.
4. Calls `hostBag.factoryResolver.registerFactory(plugin.manifest.adapterKey, factoryAdapter)` where `factoryAdapter` is a thin shim from the existing positional `AdapterFactoryPort` shape to the new bag-style:
   ```typescript
   const factoryAdapter: AdapterFactoryPort = {
     createCapabilityAdapter: (conn, cap, identifierMapping, credentialsResolver) =>
       plugin.createCapabilityAdapter(conn, cap, {
         ...hostBag,
         // Per-call overrides: AdapterFactoryPort declares identifierMapping
         // and credentialsResolver as positional per-call args. Today they
         // come from the same DI singletons as hostBag.identifierMapping /
         // hostBag.credentialsResolver, but the contract permits a caller
         // to pass different instances (e.g. a test harness), so honour
         // them verbatim. No equality assertion — the contract is the rule.
         identifierMapping,
         credentialsResolver,
       }),
   };
   ```
5. Calls `plugin.register?.(hostBag)`.

**Note on usage scope.** This helper is the *easy path* for plugins whose only infrastructure need is the curated `HostServices` bag. For in-tree Allegro and PrestaShop — which also register their own Nest providers (`AllegroQuantityCommandRepository`, `PrestashopCustomerProvisioner`, …) — we keep their existing `@Module` shape and call `createNestAdapterModule` is NOT used. See §3.4 below for the in-tree migration shape.

### 3.4 Plugin descriptors — what each in-tree plugin becomes (Shape A)

**Migration shape (committed):** in-tree integration modules keep their `@Module` decorator, their `imports`, and their `@Inject`'d constructor fields. The only change is `onModuleInit()` — it builds the `HostServices` bag from the injected fields, builds the `AdapterPlugin` descriptor from plugin-specific deps (also injected), and routes registration through the descriptor. **`createNestAdapterModule()` is NOT used for in-tree plugins** — it exists as the descriptor-only path for out-of-tree authors who don't need their own Nest providers.

Why Shape A over Shape B: Allegro registers `AllegroQuantityCommandRepository` (via `TypeOrmModule.forFeature([AllegroQuantityCommandOrmEntity])` + an `@Injectable` repository class); PrestaShop registers `PrestashopCustomerProvisioner`, `PrestashopAddressProvisioner`, `PrestashopCountryResolver`, `PrestashopWebhookProvisioningAdapter`. Pushing those through `createNestAdapterModule(options.providers)` and then back into the descriptor's closure via DI is awkward — the helper would need to support "give me back this provider instance to feed into your descriptor constructor", which is precisely the NestJS-aware glue we're trying to eliminate from the plugin contract. Keeping in-tree plugins on a thin `@Module` is the cleaner cut.

#### Allegro (after migration)

```typescript
// libs/integrations/allegro/src/allegro-plugin.ts
import type { AdapterPlugin, HostServices } from '@openlinker/plugin-sdk';
import { AllegroAdapterFactory } from './application/allegro-adapter.factory';
import { buildAllegroSchedulerTasks } from './infrastructure/scheduler/allegro-scheduler-tasks';
import { AllegroConnectionTesterAdapter } from './infrastructure/adapters/allegro-connection-tester.adapter';
import { AllegroEmailNormalizerAdapter } from './infrastructure/adapters/allegro-email-normalizer.adapter';
import { AllegroRetryClassifierAdapter } from './infrastructure/adapters/allegro-retry-classifier.adapter';

/**
 * Build an Allegro plugin descriptor. Plugin-specific cross-package services
 * (CustomerIdentityResolverPort, ConfigService, redis client, …) are passed in
 * via the constructor — this keeps `HostServices` lean and platform-neutral.
 */
export function createAllegroPlugin(deps: {
  customerIdentityResolver: CustomerIdentityResolverPort;
  tokenRefreshService?: AllegroTokenRefreshService;
  commandRepository?: AllegroQuantityCommandRepositoryPort;
  configService?: ConfigService;
  quantityPollConfig?: Partial<QuantityPollConfig>;
  catParamsTtlSec?: number;
}): AdapterPlugin {
  return {
    manifest: {
      adapterKey: 'allegro.publicapi.v1',
      platformType: 'allegro',
      supportedCapabilities: ['OrderSource', 'OfferManager'],
      displayName: 'Allegro Public API v1',
      version: '1.0.0',
      isDefault: true,
    },
    register(host) {
      host.connectionTesterRegistry.register('allegro.publicapi.v1', new AllegroConnectionTesterAdapter());
      host.emailNormalizerRegistry.register('allegro.publicapi.v1', new AllegroEmailNormalizerAdapter());
      host.retryClassifierRegistry.register('allegro.publicapi.v1', new AllegroRetryClassifierAdapter());
      if (deps.configService) {
        for (const task of buildAllegroSchedulerTasks(deps.configService)) {
          host.schedulerTaskRegistry.register(task);
        }
      }
    },
    async createCapabilityAdapter(connection, capability, host) {
      const factory = new AllegroAdapterFactory(
        deps.customerIdentityResolver,
        deps.tokenRefreshService,
        deps.commandRepository,
        deps.quantityPollConfig,
        host.cache,
        deps.catParamsTtlSec,
      );
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
      );
      switch (capability) {
        case 'OfferManager': return adapters.offerManager as unknown as T;
        case 'OrderSource': return adapters.orderSource as unknown as T;
        default: throw new Error(`Allegro: unsupported capability ${capability}`);
      }
    },
  };
}
```

The Nest module's `onModuleInit()` becomes:

```typescript
// libs/integrations/allegro/src/allegro-integration.module.ts
@Module({
  imports: [IntegrationsModule, SyncModule, CustomersModule,
            TypeOrmModule.forFeature([AllegroQuantityCommandOrmEntity])],
  providers: [/* AllegroQuantityCommandRepository, AllegroTokenRefreshService, token bindings — unchanged */],
  exports: [ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN, 'AllegroQuantityCommandRepositoryPort'],
})
export class AllegroIntegrationModule implements OnModuleInit {
  // Same `@Inject(...)` constructor as today — see §2 "Host-provided services" table.
  constructor(/* @Inject(...) all the host fields + plugin-specific deps */) {}

  onModuleInit(): void {
    // Construct the descriptor from plugin-specific deps.
    const plugin = createAllegroPlugin({
      customerIdentityResolver: this.customerIdentityResolver,
      tokenRefreshService: this.tokenRefreshService,
      commandRepository: this.commandRepository,
      configService: this.configService,
      quantityPollConfig: this.readQuantityPollConfig(),
      catParamsTtlSec: this.readCatParamsTtlSec(),
    });
    // Build the curated HostServices bag from injected host fields.
    const host: HostServices = {
      logger: (ctx) => new Logger(ctx),
      identifierMapping: this.identifierMapping,
      credentialsResolver: this.credentialsResolver,
      cache: this.cache,
      adapterRegistry: this.adapterRegistry,
      factoryResolver: this.factoryResolver,
      connectionTesterRegistry: this.connectionTesterRegistry,
      emailNormalizerRegistry: this.emailNormalizerRegistry,
      retryClassifierRegistry: this.retryClassifierRegistry,
      schedulerTaskRegistry: this.schedulerTaskRegistry,
      webhookProvisioningRegistry: this.webhookProvisioningRegistry,
    };
    // Three registration lines — same as the helper would do.
    host.adapterRegistry.register(plugin.manifest);
    host.factoryResolver.registerFactory(plugin.manifest.adapterKey, {
      createCapabilityAdapter: (conn, cap, idMap, credRes) =>
        plugin.createCapabilityAdapter(conn, cap, { ...host, identifierMapping: idMap, credentialsResolver: credRes }),
    });
    plugin.register?.(host);
  }
}
```

The win: every line of behaviour that today is inlined in `onModuleInit` (which side registries to populate, which adapters to register, how to wire seller defaults) now lives inside `createAllegroPlugin()` — a pure function over `HostServices`, importable from anywhere, framework-agnostic.

#### PrestaShop (after migration)

Same Shape A — `createPrestashopPlugin({ customerProvisioner, addressProvisioner, customerProjectionRepository, mappingConfigService, webhookSecretProvider, webhookProvisioningAdapter })`. The Nest module's `onModuleInit` becomes the same `build descriptor → build host bag → 3 registration lines` skeleton.

(Codebase casing note: `Prestashop` with lowercase `s` — matches `PrestashopIntegrationModule`, `PrestashopAdapterFactoryWrapper`, adapter key `prestashop.webservice.v1`.)

---

## 4. Step-by-Step Implementation

### Phase A — Create `@openlinker/plugin-sdk` package (closes #597)

0. **Precheck:** verify the registry-service classes the SDK helper depends on are exported from the top-level barrels we plan to import from. The SDK's `createNestAdapterModule` needs all of: `AdapterRegistryPort`, `AdapterFactoryResolverService`, `ConnectionTesterRegistryService`, `EmailNormalizerRegistryService`, `WebhookProvisioningRegistryService`, `CredentialsResolverPort`, plus the `*_TOKEN` constants — all from `@openlinker/core/integrations` — and `RetryClassifierRegistryService` + `SchedulerTaskRegistryService` from `@openlinker/core/sync`. Quick grep:
   ```bash
   grep -E "(ConnectionTesterRegistryService|EmailNormalizerRegistryService|WebhookProvisioningRegistryService|AdapterFactoryResolverService)" libs/core/src/integrations/index.ts
   grep -E "(RetryClassifierRegistryService|SchedulerTaskRegistryService)" libs/core/src/sync/index.ts
   ```
   If any are not in the barrel, add them as part of Phase A — one-line additions to the index files. ESLint barrel-only rule (#591) forbids reaching into deep paths.
1. Create `libs/plugin-sdk/` with `package.json` (name `@openlinker/plugin-sdk`, version `0.1.0`, deps on `@openlinker/core`, `@openlinker/shared`, peer dep on `@nestjs/common`), `tsconfig.json` (extends repo base), `tsconfig.build.json`, `src/index.ts`.
2. Add the workspace to `pnpm-workspace.yaml` (if needed — check current shape).
3. Wire the `@openlinker/plugin-sdk/*` alias in `tsconfig.base.json` so apps can import via the workspace name.

### Phase B — Define the contract in `@openlinker/plugin-sdk`

4. `libs/plugin-sdk/src/host-services.ts` — `HostServices` interface per §3.2.
5. `libs/plugin-sdk/src/adapter-plugin.ts` — `AdapterPlugin` interface per §3.1.
6. `libs/plugin-sdk/src/create-nest-adapter-module.ts` — `createNestAdapterModule()` helper per §3.3. Test that it produces a module that runs `register(host)` exactly once and binds the factory correctly.
7. `libs/plugin-sdk/src/index.ts` — barrel re-exporting `AdapterPlugin`, `HostServices`, `createNestAdapterModule`, `CreateNestAdapterModuleOptions`.
8. Unit test the helper (`libs/plugin-sdk/src/create-nest-adapter-module.spec.ts`) — boot a stub `AdapterPlugin`, mount via `Test.createTestingModule`, assert `adapterRegistry.register` + `factoryResolver.registerFactory` + `plugin.register` all called with the right shapes.

### Phase C — Migrate Allegro

9. Add `libs/integrations/allegro/src/allegro-plugin.ts` — `createAllegroPlugin(deps)` factory returning `AdapterPlugin`. Moves all `register(host)` body content out of `AllegroIntegrationModule.onModuleInit`.
10. Refactor `AllegroIntegrationModule`:
    - Keep its `imports` (`IntegrationsModule`, `SyncModule`, `CustomersModule`, `TypeOrmModule.forFeature(...)`).
    - Keep its providers (`AllegroQuantityCommandRepository`, `AllegroTokenRefreshService`, token bindings).
    - Replace `onModuleInit` body with: build the plugin descriptor from injected deps, build `HostServices` bag from the injected registries, call the three init lines.
    - Delete `AllegroAdapterFactoryWrapper` — the plugin's `createCapabilityAdapter` method now plays this role directly.
11. Update Allegro tests (`AllegroIntegrationModule` boot test if any; `AllegroAdapterFactoryWrapper.spec.ts` is dropped — its coverage moves to `createAllegroPlugin.spec.ts`).
12. Add `createAllegroPlugin.spec.ts` covering: manifest correctness, `register()` calls each side registry, `createCapabilityAdapter` returns the right capability instance.

### Phase D — Migrate PrestaShop

13. Add `libs/integrations/prestashop/src/prestashop-plugin.ts` — `createPrestashopPlugin(deps)` factory.
14. Refactor `PrestashopIntegrationModule` same way as step 10.
15. Delete `PrestashopAdapterFactoryWrapper`.
16. Add `createPrestashopPlugin.spec.ts` mirroring step 12.
17. Update any PS tests that import `PrestashopAdapterFactoryWrapper`.

### Phase E — Validate

18. Quality gate:
    ```bash
    pnpm lint && pnpm type-check && pnpm test
    ```
19. **Integration tests required for this PR** (not optional — the change touches the registry boundary and DI seam). Run `pnpm test:integration` and confirm `apps/api/test/integration/` is green. Critical specs to watch: connection-CRUD (factory resolution), webhook-provisioning (PS-specific registry path), any int-spec that exercises `IntegrationsService.getCapabilityAdapter`.

### Phase F — Document

20. Update `docs/architecture-overview.md` § *Adapter Registry (Code-Level)* — replace the `AllegroIntegrationModule.onModuleInit()` code-snippet example with the new `createAllegroPlugin()` shape.
21. Add a top-of-file JSDoc to `libs/plugin-sdk/src/index.ts` explaining the contract and pointing at the next deferred items (eventPublisher, db handle, npm publish).

---

## 5. Testing Strategy

| File | What to verify |
|---|---|
| `create-nest-adapter-module.spec.ts` | Helper produces a module that, when booted, calls `adapterRegistry.register(manifest)` once, registers the factory once, calls `plugin.register(host)` once. Each `HostServices` field is wired from the expected DI token. |
| `create-allegro-plugin.spec.ts` | Manifest shape matches the previously-hardcoded literal. `register(host)` calls connectionTester + emailNormalizer + retryClassifier + scheduler-task (when `configService` provided). `createCapabilityAdapter` returns OfferManager/OrderSource for the right capability strings. |
| `create-prestashop-plugin.spec.ts` | Same shape — manifest + register (connectionTester + webhookProvisioner) + createCapabilityAdapter. |
| Existing `allegro-adapter-factory-wrapper.spec.ts` / `prestashop-adapter-factory-wrapper.spec.ts` | Removed (the wrappers are deleted; their coverage moves to the plugin specs). |
| Existing connection-service / integrations-service tests | Should remain green — no behavioral change at the registry boundary. |

---

## 6. Architecture Compliance

- ✅ **Domain layer independence**: `libs/plugin-sdk/` does NOT import from any `domain/` paths in core. It imports `AdapterMetadata` from `@openlinker/core/integrations` (top-level barrel — allowed per #591).
- ✅ **Hexagonal boundary**: the SDK doesn't introduce a new layer. The `AdapterPlugin` interface is a *port* the host (NestJS module) and the plugin (descriptor) both code against.
- ✅ **Top-level barrel only**: SDK imports through `@openlinker/core/integrations`, `@openlinker/core/identifier-mapping`, `@openlinker/core/sync`, `@openlinker/shared/logging`. No deep paths.
- ✅ **No framework leak into plugins**: plugin descriptor files (`allegro-plugin.ts`, `prestashop-plugin.ts`) don't import from `@nestjs/common` — they're plain TS objects/functions that consume the framework-neutral `HostServices`. The NestJS *module* (`AllegroIntegrationModule`, `PrestashopIntegrationModule`) is the only place `@nestjs/common` shows up.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `createCapabilityAdapter`'s positional `(connection, capability, identifierMapping, credentialsResolver)` shape doesn't match the new `(connection, capability, host)` shape. Bridging is required at `AdapterFactoryResolverService.registerFactory(adapterKey, factory)` boundary. | The bridge is internal to `createNestAdapterModule` — it builds a `host` from the per-call `identifierMapping` + `credentialsResolver` overlaid on the host-wide bag (which already carries the same instances). Add an assertion in the bridge that the per-call services are reference-equal to the host's — if they ever diverge, fail loud. |
| Allegro's `@Optional()` injections (`tokenRefreshService`, `commandRepository`, `configService`, `cache`) currently let unit-test bootstraps skip importing the corresponding modules. The new module must preserve `@Optional()` semantics. | The refactored `AllegroIntegrationModule` keeps the same `@Optional()` injection list — only the `onModuleInit` body changes. Tests that bootstrap a minimal module stay green. |
| AI plugin tries to migrate by accident. | Plan explicitly excludes AI in §1 non-goals; reviewer cross-check via the `AdapterPlugin`-implementing files list — should be exactly 2 (Allegro + PrestaShop). |
| Removing `AllegroAdapterFactoryWrapper` / `PrestashopAdapterFactoryWrapper` breaks tests that import them. | Step 11 + 17 in the implementation plan explicitly cover this. Grep for `AdapterFactoryWrapper` imports across the repo before deletion. |
| `pnpm-workspace.yaml` shape — does `libs/*` glob already pick up `libs/plugin-sdk/`? | Verify before Phase A step 2; if `libs/**` is the pattern, it picks up automatically; if it's `libs/core`, `libs/shared`, … explicit, add the new entry. |

---

## 8. What's Deferred (follow-up issues if not already tracked)

- `eventPublisher` field on `HostServices` — defer until first plugin actually publishes events. New issue if not already in #599 / Thread F backlog.
- `db` handle on `HostServices` — defer; current plugins manage their own `TypeOrmModule.forFeature` registration.
- npm publishing config for `@openlinker/plugin-sdk` — covered by #596 (semver discipline) + future "publish" work.
- AI plugin doesn't fit `AdapterPlugin` shape — separate "process-wide port plugin" contract is a different design question. Out of scope; new follow-up issue if the user wants it tracked.
- Plugin-specific cross-package ports (`CustomerIdentityResolverPort`, …) staying in plugin's own DI rather than `HostServices` — by design, see §1 non-goals.

---

## 9. Open Questions

None expected — design decisions are settled. If `createCapabilityAdapter`'s positional → bag shape change runs into TypeScript inference issues at the `AdapterFactoryResolverService.registerFactory` call site, fall back to keeping `AdapterFactoryPort` signature unchanged and have the plugin descriptor's `createCapabilityAdapter` accept the same positional args as a transitional shim. Flag the divergence in the plugin spec and revisit in a follow-up.
