# Plugin Author Guide

This guide walks an external contributor through *"I want to add a new
platform integration to OpenLinker"* — say Shopify, WooCommerce, or
BigCommerce. By the end you'll know where your files go, which port to
implement, how the registry picks up your adapter, how credentials and
OAuth fit in, how to write the tests, and how to enable the plugin in
the API host.

> **What this guide is.** A map for reading
> [`libs/integrations/prestashop/`](../libs/integrations/prestashop/) —
> the project's reference adapter. The canonical reference is the code;
> this guide is the map to read it by. Copy-paste excerpts will go
> stale faster than the code does.

> **What this guide is not.** A from-zero copy-paste tutorial. Expect
> to read the reference adapter alongside this doc and assemble pieces.

## The path

1. **Pick a capability port** in `libs/core/src/<context>/domain/ports/`.
2. **Use PrestaShop as your starting point** — copy
   `libs/integrations/prestashop/` as your reference adapter.
3. **Package layout** — set up `libs/integrations/<platform>/` with the
   standard tree.
4. **Implement a capability port** as an adapter class.
5. **Write the adapter factory** that builds per-connection instances
   and resolves credentials.
6. **Wire up the `AdapterPlugin` descriptor + NestJS module** with the
   plugin SDK contract.
7. **Register connection-config and credentials shape validators** at
   boot.
8. **Handle credentials and OAuth** — static API key (PrestaShop) or
   token refresh-and-retry (Allegro).
9. **Add plugin-owned migrations** if your plugin owns any tables
   (optional, #599).
10. **Add tests** — unit specs colocated with the adapter, optional
    integration spec under `apps/api/test/integration/`.
11. **Enable the plugin** in the API host (`apps/api/src/plugins.ts` —
    a single-line edit).

Each numbered item is one section below.

---

## Prerequisites

- Node.js 18+ (LTS), pnpm 10+, Docker (for the dev stack and
  integration tests).
- Familiarity with
  [`docs/architecture-overview.md`](./architecture-overview.md) —
  especially the *Hexagonal Architecture* and *Capability
  Abstractions (Business Roles)* sections.
- Familiarity with
  [`docs/engineering-standards.md`](./engineering-standards.md) —
  especially *Naming Conventions*, *Type Definitions in Separate
  Files*, *Service Interface Implementation*, and *Import Aliases*.
- A working dev stack — see
  [`CONTRIBUTING.md § Setup Checklist`](../CONTRIBUTING.md#setup-checklist)
  for the zero-to-green sequence.

---

## Step 1 — Pick a capability port

OpenLinker's CORE defines a small closed set of "business capability"
port interfaces in `libs/core/src/<context>/domain/ports/`. An adapter
implements one or more of them.

The well-known set is `CoreCapabilityValues`, declared verbatim at
[`libs/core/src/integrations/domain/types/adapter.types.ts:22-28`](../libs/core/src/integrations/domain/types/adapter.types.ts#L22-L28):

```typescript
export const CoreCapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
] as const;
```

| Capability             | What it does                                              | Port file                                                                                                                          |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ProductMaster`        | Source of truth for product catalog (read/write).         | [`libs/core/src/products/domain/ports/product-master.port.ts`](../libs/core/src/products/domain/ports/product-master.port.ts)      |
| `InventoryMaster`      | Source of truth for stock levels.                         | [`libs/core/src/inventory/domain/ports/inventory-master.port.ts`](../libs/core/src/inventory/domain/ports/inventory-master.port.ts) |
| `OrderProcessorManager`| Order lifecycle on the destination shop (create / status).| [`libs/core/src/orders/domain/ports/order-processor-manager.port.ts`](../libs/core/src/orders/domain/ports/order-processor-manager.port.ts) |
| `OrderSource`          | Cursor-based order-event ingestion.                       | [`libs/core/src/orders/domain/ports/order-source.port.ts`](../libs/core/src/orders/domain/ports/order-source.port.ts)               |
| `OfferManager`         | Marketplace offer/listing management (split into sub-capabilities). | [`libs/core/src/listings/domain/ports/offer-manager.port.ts`](../libs/core/src/listings/domain/ports/offer-manager.port.ts)         |

**Open at the registry boundary (#576).** The set above is closed at
the type-system level (`CoreCapability` union). At the registry
boundary it's open: a plugin's
[`AdapterMetadata.supportedCapabilities`](../libs/core/src/integrations/domain/types/adapter.types.ts)
field accepts the well-known `CoreCapability` members *and* any other
string, so the registry can carry capability names that core doesn't
declare yet. If your platform doesn't fit one of the existing ports
you can declare a new capability name — coordinate with the maintainers
first, since a new capability isn't useful until something in CORE
consumes it.

**Recommendation: start with one capability and add more
incrementally.** PrestaShop ships four; you don't need to match that
on day one.

---

## Step 2 — Use PrestaShop as your starting point

[`libs/integrations/prestashop/`](../libs/integrations/prestashop/) is
the **reference adapter**. It implements four capabilities, has no
OAuth complexity, registers the full set of side-services
(connection tester, webhook provisioner, shape validators), and is the
most port-rich plugin in the tree. New plugin authors should copy this
layout.

Two pointers for special cases:

- **OAuth flow** — see
  [`libs/integrations/allegro/`](../libs/integrations/allegro/). It
  adds token tables, refresh handling, scheduler tasks, and email
  normalisation on top of the PrestaShop shape.
- **Stateless port-router (no per-connection adapter)** — see
  [`libs/integrations/ai/`](../libs/integrations/ai/). Uses a dynamic
  module (`AiIntegrationModule.register()`) and routes calls to
  per-provider instances at runtime. Reference only if your platform
  is provider-switched rather than per-connection.

For everything else, PrestaShop is the canonical template.

---

## Step 3 — Package layout

Copy this tree as your starting point (`libs/integrations/<platform>/`):

```text
libs/integrations/<platform>/
├── jest.config.mjs
├── tsconfig.json
├── package.json
├── .eslintrc.js
└── src/
    ├── index.ts                          # Barrel — see "Barrel exports" below
    ├── <platform>-plugin.ts              # createXPlugin() + adapter manifest
    ├── <platform>-integration.module.ts  # NestJS module + onModuleInit registration
    ├── application/
    │   ├── <platform>-adapter.factory.ts # Per-connection factory
    │   ├── dto/
    │   │   └── <platform>-connection-config.dto.ts
    │   ├── interfaces/                   # Factory contract (optional)
    │   └── __tests__/
    ├── domain/
    │   ├── types/                        # Connection-config + credentials + domain types
    │   └── exceptions/                   # Plugin-specific domain exceptions
    ├── infrastructure/
    │   ├── adapters/                     # Capability-port implementations + side adapters
    │   ├── http/                         # HTTP client + auth glue
    │   ├── mappers/                      # Wire-format ↔ domain mappers
    │   ├── provisioners/                 # Cross-cutting side effects (e.g. PS customer/address)
    │   └── __tests__/
    ├── migrations/                       # Plugin-owned migrations (optional, #599)
    └── __tests__/
        ├── fixtures/                     # Test fixtures
        └── mocks/                        # Mock factories
```

PrestaShop has no `migrations/` because it doesn't own any tables;
Allegro has one (the `allegro_quantity_commands` table). The rest of
the layout is the same.

### `package.json` shape

Copy from
[`libs/integrations/prestashop/package.json`](../libs/integrations/prestashop/package.json):

```jsonc
{
  "name": "@openlinker/integrations-<platform>",
  "version": "0.1.0",
  "description": "<platform> <API name> adapter for OpenLinker",
  "license": "Apache-2.0",
  "private": true,
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "require": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "test": "jest --config ./jest.config.mjs",
    "type-check": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\" --fix"
  },
  "dependencies": {
    "@openlinker/core": "workspace:*",
    "@openlinker/plugin-sdk": "workspace:*",
    "@openlinker/shared": "workspace:*",
    "class-validator": "0.14.1"
  },
  "peerDependencies": {
    "@nestjs/common": "^10.0.0"
  }
}
```

All packages are `"private": true` today. npm publishing is gated on
Modularity Thread F (#552 / #596); until that lands, plugins consume
each other via the pnpm workspace, not via the registry.

### Barrel exports (`src/index.ts`)

The barrel is the package's public surface. Export only what the host
or test fixtures need:

- The plugin factory: `createXPlugin` + `xAdapterManifest` + the
  `CreateXPluginDeps` type.
- The shape validator adapters (test fixtures sometimes need them).
- The NestJS integration module (the host imports this).
- Domain types and exceptions other packages legitimately need
  (rare).

See
[`libs/integrations/prestashop/src/index.ts`](../libs/integrations/prestashop/src/index.ts)
for the verbatim shape.

---

## Step 4 — Implement a capability port

Where the port lives in CORE drives where the adapter lives in your
plugin:

```text
CORE  → libs/core/src/orders/domain/ports/order-processor-manager.port.ts
PLUGIN → libs/integrations/<platform>/src/infrastructure/adapters/<platform>-order-processor-manager.adapter.ts
```

### Import the port through the barrel

Per
[`docs/engineering-standards.md § Import Aliases`](./engineering-standards.md#import-aliases),
**plugins cross-import via the top-level barrel only** — never deep
paths into `@openlinker/core/<ctx>/domain/...`:

```typescript
// ✅ Top-level barrel (works at runtime, passes ESLint)
import { OrderProcessorManagerPort } from '@openlinker/core/orders';

// ❌ Deep import — fails at Node runtime with ERR_PACKAGE_PATH_NOT_EXPORTED
import { OrderProcessorManagerPort } from '@openlinker/core/orders/domain/ports/order-processor-manager.port';
```

The same rule applies to ORM-entity sub-barrels — they're host-only
(#594). Plugin packages are ESLint-blocked from importing any
`@openlinker/core/<ctx>/orm-entities` path. If you find yourself
wanting to, stop: you're reaching for an infrastructure detail that
shouldn't cross the port boundary.

### Adapter shape

Naming: `{Platform}{Capability}Adapter` (PascalCase), one file per
adapter, filename `<platform>-<capability>.adapter.ts`. See the
naming rules in
[`docs/engineering-standards.md § Class Names — Adapters`](./engineering-standards.md#adapters).

```typescript
// libs/integrations/<platform>/src/infrastructure/adapters/<platform>-order-processor-manager.adapter.ts

import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type {
  OrderProcessorManagerPort,
  OrderCreate,
  Order,
  OrderStatus,
} from '@openlinker/core/orders';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { XHttpClient } from '../http/x-http-client';

@Injectable()
export class XOrderProcessorManagerAdapter implements OrderProcessorManagerPort {
  private readonly logger = new Logger(XOrderProcessorManagerAdapter.name);

  constructor(
    private readonly httpClient: XHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    // ... other plugin-internal deps
  ) {}

  async createOrder(order: OrderCreate): Promise<Order> {
    // 1. Translate internal IDs → external IDs via identifierMapping
    // 2. Call the platform API
    // 3. Map response → unified Order
    // 4. Translate platform errors → domain exceptions
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    // ...
  }

  // Throw for unsupported operations rather than returning a half-baked result.
}
```

Concrete worked example:
[`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`](../libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts).

### Error handling

Adapters must translate platform errors into domain exceptions. Per
[`docs/engineering-standards.md § Error Handling`](./engineering-standards.md#error-handling),
domain exceptions live in `<plugin>/src/domain/exceptions/`. Never
leak platform HTTP status codes or SDK error types through the port
return.

---

## Step 5 — Write the adapter factory

A plugin has many ports per capability, but adapters are
**per-connection** — same plugin, different `Connection.config` and
credentials means different adapter instances. The factory is what
builds them at runtime.

```typescript
// libs/integrations/<platform>/src/application/<platform>-adapter.factory.ts

import { Injectable } from '@nestjs/common';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  IdentifierMappingPort,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { XConnectionConfig } from '../domain/types/x-config.types';
import type { XCredentials } from '../domain/types/x-credentials.types';

@Injectable()
export class XAdapterFactory {
  constructor(/* plugin-internal deps — provisioners, repositories, refreshers */) {}

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<XAdapters> {
    // 1. Validate + parse Connection.config (JSONB blob from operator).
    const config = this.validateAndParseConfig(connection.config);

    // 2. Resolve credentials at adapter-construction time, NOT in the
    //    factory constructor. Credentials are per-connection; the
    //    factory is process-wide.
    const credentials = await credentialsResolver.get<XCredentials>(
      connection.credentialsRef,
    );

    // 3. Build the HTTP client(s) with config + credentials.
    const http = new XHttpClient(config.baseUrl, credentials, ...);

    // 4. Construct each capability adapter and return them keyed by
    //    capability name.
    return {
      productMaster: new XProductMasterAdapter(http, identifierMapping, ...),
      inventoryMaster: new XInventoryMasterAdapter(http, identifierMapping, ...),
      orderSource: new XOrderSourceAdapter(http, identifierMapping, ...),
      orderProcessorManager: new XOrderProcessorManagerAdapter(http, identifierMapping, ...),
    };
  }

  private validateAndParseConfig(raw: unknown): XConnectionConfig {
    // Use the same DTO + class-validator pipeline as Step 6.
  }
}
```

Concrete worked example:
[`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`](../libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts).

### `adapterKey` naming

Format: `<platform>.<api-name>.v<version>` (lowercase, dot-separated).
Examples in the tree:

- `prestashop.webservice.v1`
- `allegro.publicapi.v1`

The version suffix lets you ship a v2 alongside the v1 for the same
`platformType` without a breaking-change PR.

### Static manifest export (#575)

Export the manifest as a top-level `const` co-located with the plugin
factory, so consumers can read it without booting NestJS:

```typescript
// libs/integrations/<platform>/src/<platform>-plugin.ts
import type { AdapterMetadata } from '@openlinker/core/integrations';

export const xAdapterManifest: AdapterMetadata = {
  adapterKey: 'x.publicapi.v1',
  platformType: 'x',
  supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
  displayName: 'X Public API v1',
  version: '1.0.0',
  isDefault: true,
};
```

The runtime `plugin.manifest` returns this same object reference, so
static and runtime views can't drift.

---

## Step 6 — Wire up the `AdapterPlugin` descriptor

The plugin contract lives in
[`libs/plugin-sdk/src/adapter-plugin.ts:42-110`](../libs/plugin-sdk/src/adapter-plugin.ts#L42-L110)
(the header comment is the contract spec — read it in full before
authoring your plugin). Its four fields:

- `manifest: AdapterMetadata` — required; the static export from
  Step 5.
- `register?(host: HostServices): void` — optional; side-registrations
  beyond the base manifest + factory. Called once at boot.
- `createCapabilityAdapter<T>(connection, capability, host)` —
  required; the per-connection factory entry point.
- `migrations?: readonly string[]` — optional; informational pointer
  to plugin-owned migration globs (host enablement is separate — see
  Step 8).

The `HostServices` bag passed into `register` and `createCapabilityAdapter`
is defined at
[`libs/plugin-sdk/src/host-services.ts:50-121`](../libs/plugin-sdk/src/host-services.ts#L50-L121).
It splits into two blocks:

- **Read inputs** (use): `logger`, `identifierMapping`,
  `credentialsResolver`, optional `cache`.
- **Side registries** (register into at boot): `adapterRegistry`,
  `factoryResolver`, `connectionTesterRegistry`,
  `emailNormalizerRegistry`, `retryClassifierRegistry`,
  `schedulerTaskRegistry`, `webhookProvisioningRegistry`,
  `connectionConfigShapeValidatorRegistry`,
  `connectionCredentialsShapeValidatorRegistry`.

**Plugin-specific cross-package deps** (your customer-projection
repository, mapping-config service, etc.) are *not* in the
`HostServices` bag. Plugins pass them via the factory constructor
closure — see `CreatePrestashopPluginDeps` at
[`libs/integrations/prestashop/src/prestashop-plugin.ts`](../libs/integrations/prestashop/src/prestashop-plugin.ts).

### Two authoring patterns

**Default to the inline-from-module pattern (below).** Most real-world
plugins land there because they have at least one plugin-specific
`@Injectable` — a repository, provisioner, HTTP client, or refresh
service. Allegro and PrestaShop both use it. The
`createNestAdapterModule` helper covered first is the easy path for
truly thin plugins; don't fight it if your plugin grows beyond that.

**Simple case (no plugin-specific Nest providers).** Use the
[`createNestAdapterModule(plugin)`](../libs/plugin-sdk/src/create-nest-adapter-module.ts)
helper. The whole module file becomes:

```typescript
// libs/integrations/<platform>/src/x-integration.module.ts
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createXPlugin } from './x-plugin';

export const XIntegrationModule = createNestAdapterModule({
  plugin: createXPlugin({ /* deps */ }),
});
```

**Inline-from-module (the common case — Allegro + PrestaShop).** When
your plugin needs its own `@Injectable` providers (repositories,
provisioners, HTTP clients), write an explicit `OnModuleInit` module:

```typescript
// libs/integrations/<platform>/src/x-integration.module.ts
@Module({
  imports: [IntegrationsModule, /* plugin-specific imports */],
  providers: [
    XCustomerProvisioner,
    XAddressProvisioner,
    /* … your @Injectable providers */
  ],
})
export class XIntegrationModule implements OnModuleInit {
  constructor(
    @Inject(ADAPTER_REGISTRY_TOKEN) private adapterRegistry: AdapterRegistryPort,
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN) private factoryResolver: AdapterFactoryResolverService,
    /* + the rest of HostServices registries you need + your plugin-specific deps */
  ) {}

  onModuleInit(): void {
    const plugin = createXPlugin({
      customerProvisioner: this.customerProvisioner,
      // ... rest of CreateXPluginDeps
    });
    const host: HostServices = { /* build from @Inject'd fields */ };

    this.adapterRegistry.register(plugin.manifest);
    this.factoryResolver.registerFactory(plugin.manifest.adapterKey, /* … */);
    plugin.register?.(host);
  }
}
```

Concrete worked example:
[`libs/integrations/prestashop/src/prestashop-integration.module.ts`](../libs/integrations/prestashop/src/prestashop-integration.module.ts).

### `dispatchCapability` helper

Inside `createCapabilityAdapter`, use
[`dispatchCapability`](../libs/plugin-sdk/src/dispatch-capability.ts)
to dispatch the `capability: string` argument to the right adapter.
It hardens against prototype-pollution and produces a uniform error
message format across plugins:

```typescript
return dispatchCapability<T>(
  capability,
  {
    ProductMaster: () => adapters.productMaster,
    InventoryMaster: () => adapters.inventoryMaster,
    OrderSource: () => adapters.orderSource,
    OrderProcessorManager: () => adapters.orderProcessorManager,
  },
  'X',
);
```

---

## Step 7 — Connection-config and credentials shape validation

Operators submit `Connection.config` (a JSONB blob) and credentials
when they create a connection. Two ports (#586, #587) let the plugin
validate the shape of each before encryption / persistence:

- `ConnectionConfigShapeValidatorPort` — validates the structure of
  `Connection.config`. *"Are the required fields present, are URLs
  parseable, are enum values in range?"*
- `ConnectionCredentialsShapeValidatorPort` — validates the structure
  of the raw credentials payload. *"Does the API-key string match the
  expected length / charset?"* — **shape only**, not authentication.

Both are plugin-private. Register them in your plugin's `register(host)`:

```typescript
host.connectionConfigShapeValidatorRegistry.register(
  'x.publicapi.v1',
  new XConnectionConfigShapeValidatorAdapter('X'),
);
host.connectionCredentialsShapeValidatorRegistry.register(
  'x.publicapi.v1',
  new XConnectionCredentialsShapeValidatorAdapter('X'),
);
```

The adapter implementation wraps a `class-validator` DTO and returns
shape errors as domain exceptions. See:

- [`libs/integrations/prestashop/src/application/dto/prestashop-connection-config.dto.ts`](../libs/integrations/prestashop/src/application/dto/prestashop-connection-config.dto.ts)
- [`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-config-shape-validator.adapter.ts`](../libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-config-shape-validator.adapter.ts)
- [`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter.ts`](../libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter.ts)

**Shape validation ≠ live-credentials test.** "Do these credentials
actually authenticate against the live API?" is a *connection test*,
handled by `ConnectionTesterPort` — a separate registry, also
registered in your plugin's `register(host)`. The shape validator
runs synchronously at create-time; the connection tester runs against
the live API and is triggered by the operator.

---

## Step 8 — Credentials and OAuth

Credentials are encrypted at rest in the `integration_credentials`
table (core schema). Your plugin doesn't read that table directly;
the `CredentialsResolverPort` decrypts and returns the payload typed
to your plugin's credentials type:

```typescript
const credentials = await credentialsResolver.get<XCredentials>(
  connection.credentialsRef,
);
```

`XCredentials` is a plugin-private type in `<plugin>/src/domain/types/`.
Two shapes are common:

### Non-OAuth (PrestaShop)

A static API key. The shape is `{ apiKey: string }` (or similar);
the operator provides it at create-time, the shape validator (Step 7)
validates it before encryption, the factory pulls it on every
adapter construction. No refresh, no token state — just read once
per `createAdapters` call.

See:
- [`libs/integrations/prestashop/src/domain/types/prestashop-credentials.types.ts`](../libs/integrations/prestashop/src/domain/types/prestashop-credentials.types.ts)
- The factory's `credentialsResolver.get<...>` call at
  [`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`](../libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts).

### OAuth (Allegro)

OAuth is more involved. The shape your plugin needs to replicate:

- **Token tables** — a plugin-owned migration creates a token-state
  table (Allegro has `allegro_quantity_commands` for its work-queue;
  tokens themselves are stored in `integration_credentials` and
  refreshed in place). Example migration:
  [`libs/integrations/allegro/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts`](../libs/integrations/allegro/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts).
- **Token-refresh service** — encapsulates the refresh-token flow.
  Allegro's lives in `libs/integrations/allegro/src/application/`
  and exposes a method the HTTP client calls when it gets a 401.
- **Shared token state** — Allegro's
  [`AllegroConnectionTokenState`](../libs/integrations/allegro/src/infrastructure/http/allegro-connection-token-state.ts)
  is an in-memory token + expiry, shared between the OAuth HTTP
  client and the webservice HTTP client. When a refresh succeeds,
  it updates this state, and *both* clients see the new token on
  their next call. External plugin authors need to replicate this
  pattern if they have multiple HTTP clients per connection.
- **401 → refresh → retry handler** — the HTTP client wraps each
  request: on 401, it calls the refresh service, updates the shared
  state, and retries the original request exactly once. Lives in
  [`libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`](../libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts).
- **OAuth callback handler** — the redirect-back leg of the OAuth
  flow is handled at the API layer
  (`apps/api/src/integrations/...`), not in the plugin. Your plugin
  exposes the authorise-URL builder; the host wires it into a
  controller. PrestaShop has no equivalent because it's static-key
  auth.

For the long-form walkthrough, read the Allegro HTTP layer end to end:
[`libs/integrations/allegro/src/infrastructure/http/`](../libs/integrations/allegro/src/infrastructure/http/).
The header comments in `allegro-http-client.ts` carry the full
sequence diagram in prose.

---

## Step 9 — Plugin-owned migrations (optional, #599)

Skip this step if your plugin doesn't own any tables. Read
[`docs/migrations.md § Plugin-Owned Migrations (#599)`](./migrations.md#plugin-owned-migrations-599)
end-to-end if it does.

The recipe in three edits:

1. **Create the migration file** under
   `libs/integrations/<platform>/src/migrations/`. Same
   `MigrationInterface` shape as core migrations; class name + filename
   timestamp must match the 13-digit-prefix invariant
   (`scripts/check-migration-timestamps.mjs` fails `pnpm lint` on
   collision or drift).

2. **Declare the migration glob** on your plugin descriptor
   (informational — the TypeORM CLI does not read plugin descriptors,
   the host enablement file in step 3 is the canonical seam):

   ```typescript
   // libs/integrations/<platform>/src/x-plugin.ts
   import { resolve } from 'node:path';
   export function createXPlugin(deps): AdapterPlugin {
     return {
       manifest: xAdapterManifest,
       migrations: [resolve(__dirname, 'migrations/**/*{.ts,.js}')],
       // ...
     };
   }
   ```

3. **Enable in the host** — two parallel edits (both required):
   - Append the plugin dir to `PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT`
     in [`apps/api/src/plugin-migrations.ts`](../apps/api/src/plugin-migrations.ts).
   - Append the same dir to the `directories` array in
     [`scripts/plugin-migration-dirs.json`](../scripts/plugin-migration-dirs.json).
   - `scripts/check-migration-timestamps.mjs` cross-checks the two
     lists; drift fails `pnpm lint`.

A plugin in `plugins.ts` whose migration globs are *not* also in
`plugin-migrations.ts` will boot, register its adapter, and then crash
on the first attempt to use its tables with `relation "..." does not
exist`. Keep the two lists aligned.

---

## Step 10 — Tests

Two layers, both required for a production-ready adapter.

### Unit tests (`*.spec.ts`)

Colocated with the adapter — `__tests__/<name>.spec.ts` next to the
file under test. Each capability adapter should have a spec covering:

- Request shape — what bytes go on the wire, what headers, what
  encoding.
- Response parsing — happy-path + error responses, edge cases (empty
  arrays, null fields, missing optional sections).
- Error mapping — platform error → domain exception.
- Port contract — every method on the interface is exercised.

Mock the HTTP client and `IdentifierMappingPort` via the fixture /
mock factories under `<plugin>/src/__tests__/{fixtures,mocks}/`. See
[`docs/engineering-standards.md § Testing Standards`](./engineering-standards.md#testing-standards)
for naming and the mock-ports rule (mock the *port interface*, not
the concrete adapter — except in this case where the adapter *is*
the system under test, in which case you mock everything *it* depends on).

PrestaShop's adapter specs:
[`libs/integrations/prestashop/src/infrastructure/adapters/__tests__/`](../libs/integrations/prestashop/src/infrastructure/adapters/__tests__/).

### Integration tests (`*.int-spec.ts`)

Optional but high-value for a new plugin. Live under
`apps/api/test/integration/`, opt into the PrestaShop Testcontainer
helper if your test depends on a real PrestaShop response (see
[`docs/testing-guide.md § PrestaShop Testcontainer Pattern (#506)`](./testing-guide.md#prestashop-testcontainer-pattern-506)).

Reference vertical-slice spec:
[`apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts`](../apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts).
It exercises `OrderIngestionService.syncOrderFromSource` end-to-end
with a stubbed Allegro source and a real PrestaShop destination. Copy
its shape for cross-adapter integration tests.

### Quality gate

Before pushing, run from the repo root:

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit specs pass
```

The pre-commit hook (`husky`) runs the same triple — push will fail
if any of the three fails.

---

## Step 11 — Enable the plugin in the host

Edit [`apps/api/src/plugins.ts`](../apps/api/src/plugins.ts) — append
your `XIntegrationModule` to the `apiPlugins` array. That's the entire
host-enablement step.

```typescript
import { XIntegrationModule } from '@openlinker/integrations-x';

export const apiPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
  AiIntegrationModule.register(),
  XIntegrationModule, // ← your plugin
];
```

`PluginRegistryModule.forRoot({ plugins: apiPlugins })` (in
[`apps/api/src/integrations/integrations.module.ts`](../apps/api/src/integrations/integrations.module.ts))
imports every plugin module; each plugin's `onModuleInit` runs at
boot and self-registers against the host registries.

---

## Things plugin authors trip on

- **Top-level barrel only** for cross-package imports (#591). ESLint
  rejects deep imports into `@openlinker/core/<ctx>/domain/...` and
  Node fails them at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **No `orm-entities` sub-barrel imports from plugins** (#594).
  TypeORM entities are infrastructure detail; if you find yourself
  reaching for `@openlinker/core/<ctx>/orm-entities`, you're crossing
  the port boundary — back off.
- **Plugin packages are `private: true` today.** npm publishing
  depends on Modularity Thread F (#552, #596). Until then, plugins
  are workspace-only.
- **Migrations need two-edit host wire-up.** `apps/api/src/plugin-migrations.ts`
  + `scripts/plugin-migration-dirs.json` must agree. Drift fails
  `pnpm lint`. Missing migration-dir entry surfaces as `relation "..."
  does not exist` at runtime.
- **Credentials are per-connection, factory is process-wide.** Call
  `credentialsResolver.get()` inside `createAdapters()`, not in the
  factory constructor.
- **Capability is open at the registry boundary (#576).** You can
  declare a new capability name beyond `CoreCapabilityValues`, but
  it's not useful until something in CORE consumes it. Talk to the
  maintainers first.
- **OAuth shared state.** If your plugin has multiple HTTP clients
  per connection, share the token state via a module-scoped object
  (see `AllegroConnectionTokenState`), not via per-client copies.
- **Plugin-specific cross-package deps are not in `HostServices`.**
  Pass them through your `createXPlugin(deps)` factory closure. See
  `CreatePrestashopPluginDeps` for the canonical shape.

---

## Where to ask questions

- **General questions or discussion.** Open a GitHub issue using the
  existing templates at `.github/ISSUE_TEMPLATE/`. An
  integration-specific template is planned (#567); until it lands,
  the developer-task template fits.
- **Security or vulnerability disclosure.** Follow
  [`SECURITY.md`](../SECURITY.md) — never open a public issue for a
  security report.
- **Architecture questions about a new capability port or a CORE
  change.** Open a proposal issue first per
  [`GOVERNANCE.md § Decision-making`](../GOVERNANCE.md#decision-making).
  Major changes to `docs/architecture-overview.md` /
  `docs/engineering-standards.md` need maintainer alignment before
  the PR.

---

## Related reading

- [`docs/architecture-overview.md`](./architecture-overview.md) — the
  big picture.
- [`docs/engineering-standards.md`](./engineering-standards.md) —
  naming conventions, import-aliases rules, type-definition rules,
  service-interface separation.
- [`docs/connections-and-adapter-resolution.md`](./connections-and-adapter-resolution.md)
  — how the registry resolves an adapter for a given
  `(connection, capability)` pair at request time.
- [`docs/migrations.md`](./migrations.md) — full migration workflow
  including the plugin-owned-migrations recipe (#599).
- [`docs/testing-guide.md`](./testing-guide.md) — Testcontainers,
  vertical-slice patterns, the PrestaShop opt-in helper.
- [`libs/plugin-sdk/src/adapter-plugin.ts:42-110`](../libs/plugin-sdk/src/adapter-plugin.ts#L42-L110)
  — the `AdapterPlugin` contract spec, header-comment form.
- [`libs/plugin-sdk/src/host-services.ts:50-121`](../libs/plugin-sdk/src/host-services.ts#L50-L121)
  — the `HostServices` bag, fields split into read-inputs vs side
  registries.

---

<sub>**Last verified at commit `f2cf874`** (`bbca59d` series merged
2026-05-13). If you spot drift between this guide and the live code —
or hit a step that's wrong or unclear — please open an issue or PR.
A lint-time invariant that checks the verbatim quotes against the
source is tracked in [#680](https://github.com/SilkSoftwareHouse/openlinker/issues/680).
The code is the spec; this guide is the map. Maps go stale; the
code can't.</sub>
