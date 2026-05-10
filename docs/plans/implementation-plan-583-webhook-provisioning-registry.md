# Implementation Plan — #583 WebhookProvisioningPort + registry

## 1. Goal

Close `[E3] [HIGH]` from Modularity Thread E (#551). Today the supposedly
generic `POST /connections/:id/webhooks/install` endpoint injects
`IPrestashopWebhookProvisioningService` directly from
`@openlinker/integrations-prestashop`. Consequence: `apps/api` literally fails
to boot if the PrestaShop integration module is removed. A user who only
wants Shopify cannot disable PrestaShop without editing core.

The fix mirrors the pattern `ConnectionTesterRegistryService` already uses
correctly — and the same shape #570/#571 just landed for the adapter
registry: introduce a neutral port + registry in `libs/core`, have each
integration module self-register its implementation in `onModuleInit`, and
have the controller route by `connection.platformType` (via
`metadata.adapterKey`) instead of injecting a platform-specific token.

Layer: **CORE port + registry, Integration self-registration, API rewire.**
Non-goals (out of scope for this PR):
- Capability-check gating (`metadata.supportedCapabilities.includes(...)`)
  — the issue suggests this as a follow-up; today the registry presence
  itself is the gate.
- Migrating `WebhookProvisioningResult` to a richer shape (e.g.,
  structured errors). Pure rename of `InstallWebhooksResult`.
- Allegro / future-platform implementations of the port. They can register
  later; this PR only wires PrestaShop.

## 2. Design

### 2.1 New port in CORE

`libs/core/src/integrations/domain/types/webhook-provisioning.types.ts`:

```typescript
export interface WebhookProvisioningResult {
  webhooksConfigured: boolean;
  testPingTriggered: boolean;
  warning?: string;
}
```

`libs/core/src/integrations/domain/ports/webhook-provisioning.port.ts`:

```typescript
import type { WebhookProvisioningResult } from '../types/webhook-provisioning.types';

export interface WebhookProvisioningPort {
  install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult>;
}
```

Identical shape to today's `IPrestashopWebhookProvisioningService.install`,
just renamed to neutral language. The PS-specific `InstallWebhooksResult`
moves into core under the neutral name `WebhookProvisioningResult`.

### 2.2 Registry service in CORE

`libs/core/src/integrations/infrastructure/adapters/webhook-provisioning-registry.service.ts`
— direct copy of `ConnectionTesterRegistryService`:

```typescript
@Injectable()
export class WebhookProvisioningRegistryService {
  private readonly provisioners: Map<string, WebhookProvisioningPort> = new Map();

  register(adapterKey: string, provisioner: WebhookProvisioningPort): void {
    this.provisioners.set(adapterKey, provisioner);
  }

  get(adapterKey: string): WebhookProvisioningPort | undefined {
    return this.provisioners.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.provisioners.has(adapterKey);
  }
}
```

**Note**: keep silent overwrite on duplicate `adapterKey` for symmetry with
`ConnectionTesterRegistryService.register` (line 19-21 of that file). The
duplicate-fail discussion from #570 ended with `AdapterRegistryService` and
`AdapterFactoryResolverService` being loud, but the connection-tester
registry stayed silent because there's no metadata-divergence risk; same
applies here. Single-line registration in the integration module makes
double-registration a near-impossibility.

### 2.3 Token + module wiring

- Add `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` to
  `libs/core/src/integrations/integrations.tokens.ts`.
- Provide + export from `libs/core/src/integrations/integrations.module.ts`.
- Re-export the port, types, service, and token from
  `libs/core/src/integrations/index.ts`.

### 2.4 PS integration changes — rename to adapter, move under `infrastructure/adapters/`

Per `engineering-standards.md` §"Naming Conventions": adapters implement
ports with the `{System}{Capability}Adapter` pattern and live in
`infrastructure/adapters/`; services implement an `I{Purpose}Service`
interface in a separate file. After this refactor the class is effectively
an adapter — HTTP side-effects against PS WS, implements a CORE port — so
following the adapter convention sets the right precedent for the next
platform that registers a `WebhookProvisioningPort` impl.

**Rename + relocate:**

- `libs/integrations/prestashop/src/application/services/prestashop-webhook-provisioning.service.ts`
  → `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-webhook-provisioning.adapter.ts`
- Class: `PrestashopWebhookProvisioningService` →
  `PrestashopWebhookProvisioningAdapter`
- `implements WebhookProvisioningPort` (port from CORE)
- Return type `Promise<WebhookProvisioningResult>`
- The colocated test
  (`__tests__/prestashop-webhook-provisioning.service.spec.ts`) moves
  alongside (`__tests__/prestashop-webhook-provisioning.adapter.spec.ts`)
  and gets the class-name + result-type rename.

**Delete:**

- `libs/integrations/prestashop/src/application/interfaces/prestashop-webhook-provisioning.service.interface.ts`
  — the PS-specific interface + token; nothing else needs the legacy
  abstraction once the adapter implements the CORE port directly.

**Update `libs/integrations/prestashop/src/prestashop-integration.module.ts`:**

- Drop the `PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN` provider/export.
- Register `PrestashopWebhookProvisioningAdapter` as a provider (replaces
  the service registration).
- In `onModuleInit`, after registering metadata + factory + tester, register
  the webhook provisioner against the new registry:
  ```typescript
  this.webhookProvisioningRegistry.register(
    'prestashop.webservice.v1',
    this.webhookProvisioningAdapter,
  );
  ```
- Inject `PrestashopWebhookProvisioningAdapter` (concrete class — it's a
  provider in the same module) plus the registry via
  `WEBHOOK_PROVISIONING_REGISTRY_TOKEN`.

**Update `libs/integrations/prestashop/src/index.ts`:**

- Drop `IPrestashopWebhookProvisioningService`, `InstallWebhooksResult`,
  `PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN` exports.
- Replace `PrestashopWebhookProvisioningService` export with
  `PrestashopWebhookProvisioningAdapter` (the existing PR #543 int-spec
  imports the class directly; one-line import update there).

### 2.5 API rewire — application service owns the dispatch

The dispatch belongs in the application layer, not the controller. Mirror
`ConnectionService.testConnection` (same shape, same error-message style)
so the two parallel surfaces stay symmetric and future
`WebhookProvisioningPort` consumers don't have to relearn the layering.

`apps/api/src/integrations/application/services/connection.service.ts` —
new method:

```typescript
async installWebhooks(
  connectionId: string,
  actorUserId?: string,
): Promise<WebhookProvisioningResult> {
  const connection = await this.get(connectionId);
  const metadata = await this.integrationsService.resolveAdapterMetadata({
    platformType: connection.platformType,
    adapterKey: connection.adapterKey,
  });
  const provisioner = this.webhookProvisioningRegistry.get(metadata.adapterKey);
  if (!provisioner) {
    throw new BadRequestException(
      `Webhook auto-provisioning is not supported for adapter ${metadata.adapterKey}`,
    );
  }
  this.logger.log(
    `Installing webhooks on connection ${connectionId} (adapter: ${metadata.adapterKey})`,
  );
  return provisioner.install(connectionId, actorUserId);
}
```

Constructor gains:

```typescript
@Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
```

`apps/api/src/integrations/http/connection.controller.ts` — controller
becomes a thin pass-through, dropping both the PS-token injection and the
direct `INTEGRATIONS_SERVICE_TOKEN` injection if no other endpoint needed
it (see audit note below):

```typescript
async installWebhooks(
  @Param('id') id: string,
  @CurrentUser() user: AuthenticatedUser,
): Promise<InstallWebhooksResponseDto> {
  return this.connectionService.installWebhooks(id, user?.id);
}
```

(Note: keep `INTEGRATIONS_SERVICE_TOKEN` if `toResponse` still needs it for
adapter-metadata resolution — that's a separate flow.)

### 2.6 Test updates

- **`connection.service.spec.ts`** (apps/api): add tests for the new
  `installWebhooks` method covering (a) happy path — registry hit →
  delegates to provisioner with the right args; (b) 400 path — registry
  miss → `BadRequestException` with the adapter-key message. Mirrors the
  existing `testConnection` test layout.
- **`connection.controller.spec.ts`**: drop the
  `PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN` mock entirely. The
  installWebhooks controller test now mocks `connectionService.installWebhooks`
  directly and asserts the controller passes through `id, user.id` and
  returns the result. Same pattern as `testConnection`'s controller test.
- **`prestashop-webhook-provisioning.adapter.spec.ts`** (renamed from the
  service spec): class-name + result-type rename. Existing test bodies
  stay.
- **No standalone `webhook-provisioning-registry.service.spec.ts`** — the
  registry is exercised through `ConnectionService.installWebhooks`'s spec
  (the same way `ConnectionTesterRegistryService` has no standalone spec
  and is covered through `ConnectionService.testConnection`). Following the
  existing precedent rather than introducing more coverage than the
  parallel surface.

### 2.7 Doc updates

- `docs/architecture-overview.md` §10 Plugin Manager / Integrations:
  - Add `WebhookProvisioningRegistryService` to the *Key Services* line
    alongside `IntegrationsService`, `AdapterRegistryService`,
    `ConnectionService`.
  - Note explicitly: "Per-integration provisioners register themselves via
    `onModuleInit`" so the doc-vs-code symmetry with the existing
    adapter-registry / connection-tester registration narrative is
    preserved.

## 3. Step-by-step

| # | File | Change | Acceptance |
|---|------|--------|------------|
| 1 | `libs/core/src/integrations/domain/types/webhook-provisioning.types.ts` (new) | `WebhookProvisioningResult` interface | Compiles |
| 2 | `libs/core/src/integrations/domain/ports/webhook-provisioning.port.ts` (new) | `WebhookProvisioningPort` interface | Compiles |
| 3 | `libs/core/src/integrations/infrastructure/adapters/webhook-provisioning-registry.service.ts` (new) | Mirror of `ConnectionTesterRegistryService` | Compiles |
| 4 | `libs/core/src/integrations/integrations.tokens.ts` | Add `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` | Token exported |
| 5 | `libs/core/src/integrations/integrations.module.ts` | Provide + export `WebhookProvisioningRegistryService` + token | Boots clean |
| 6 | `libs/core/src/integrations/index.ts` | Re-export port, type, service, token | Public surface up to date |
| 7 | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-webhook-provisioning.adapter.ts` (renamed from `application/services/prestashop-webhook-provisioning.service.ts`) | Class renamed `…Service` → `…Adapter`; `implements WebhookProvisioningPort`; rename return type | Type-checks |
| 8 | `libs/integrations/prestashop/src/application/interfaces/prestashop-webhook-provisioning.service.interface.ts` | **Delete** | No remaining references |
| 9 | `libs/integrations/prestashop/src/prestashop-integration.module.ts` | Drop PS-specific token provider/export; inject webhook registry; register adapter in `onModuleInit` | Module boots, registers cleanly |
| 10 | `libs/integrations/prestashop/src/index.ts` | Drop the three deleted exports; export `PrestashopWebhookProvisioningAdapter` | Lint clean |
| 11 | `apps/api/src/integrations/application/services/connection.service.ts` | New `installWebhooks(connectionId, actorUserId?)` method; inject `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` | Method exists, type-checks |
| 12 | `apps/api/src/integrations/http/connection.controller.ts` | Drop PS-token injection; rewrite `installWebhooks` as one-line pass-through to `connectionService.installWebhooks` | Endpoint behaviour unchanged for PS |
| 13 | `apps/api/src/integrations/application/services/connection.service.spec.ts` | Add `installWebhooks` happy + 400 paths; mirror `testConnection` layout | All pass |
| 14 | `apps/api/src/integrations/http/connection.controller.spec.ts` | Drop PS-token mock; mock `connectionService.installWebhooks` for the controller test | All pass |
| 15 | `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-webhook-provisioning.adapter.spec.ts` (renamed from `application/services/__tests__/…service.spec.ts`) | Class-name rename; result-type rename | All pass |
| 16 | `apps/api/test/integration/prestashop/prestashop-webhook-provisioning.int-spec.ts` (existing, from PR #543) | Update class import to `PrestashopWebhookProvisioningAdapter` | Int-spec passes |
| 17 | `docs/architecture-overview.md` §10 | Add `WebhookProvisioningRegistryService` to *Key Services*; note onModuleInit registration | Doc reflects new wiring |

## 4. Validation

### Architecture compliance
- Port lives in `libs/core/src/integrations/domain/ports/` ✓
- Registry service in `libs/core/src/integrations/infrastructure/adapters/` ✓
- Type in separate `*.types.ts` file ✓
- Domain layer has zero framework deps (port file only imports types) ✓
- API → CORE port (no PS dependency from `apps/api/src/integrations/http/`) ✓
- Integration self-registers in `onModuleInit` (mirrors connection-tester) ✓

### Naming
- `WebhookProvisioningPort` per `{Capability}Port` rule ✓
- `WebhookProvisioningRegistryService` per existing sister registry ✓
- `WEBHOOK_PROVISIONING_REGISTRY_TOKEN` per `{CONTEXT}_{INTERFACE}_TOKEN` ✓

### Behaviour preservation
- For PS connections, the install endpoint still produces the same response
  shape and HTTP code (200) and the same set of warnings.
- For non-PS connections, the **error message changes**. Today the request
  enters `PrestashopWebhookProvisioningService.install` and throws
  `"Connection {id} is not a PrestaShop connection (platformType=X). Webhook
  auto-install only applies to PrestaShop connections."` After the refactor,
  `ConnectionService.installWebhooks` throws *before* reaching any
  provisioner with `"Webhook auto-provisioning is not supported for adapter
  X"`. The new message is shorter (mirrors `testConnection`'s style) and
  loses the "what to do" hint, but is generically correct for any
  unsupported-platform — this is the right tradeoff once webhook
  auto-provisioning becomes a per-platform capability rather than a
  PrestaShop-only flow. Worth flagging for any operator script that
  matched on the old wording.

### Testing strategy
- Unit: small registry spec + updated controller spec covering both
  branches (PS happy path + unsupported-platform 400).
- Integration: existing `prestashop-webhook-provisioning.int-spec.ts`
  routes through the controller via supertest already; should pass
  unchanged because the FE-visible response is unchanged.

### Security / blast radius
- Single boot path. The PS integration module's import in
  `apps/api/src/integrations/integrations.module.ts` stays — only the
  controller's injection token changes. No DI rewiring across packages.
- No schema changes, no migration.

## 5. Risks & open questions

- **PR #543 int-spec** (`prestashop-webhook-provisioning.int-spec.ts` from
  #541): instantiates `PrestashopWebhookProvisioningService` directly, so
  the result-type rename is its only impact. It passes unchanged after the
  type import is updated.
- **FE coupling**: the FE has its own hand-written `InstallWebhooksResult`
  in `apps/web/src/features/connections/api/connections.types.ts`. The
  HTTP shape is identical, so no FE changes needed.
- **Future Allegro/Shopify**: registering a platform that doesn't support
  webhook auto-install just means *not* registering against the registry —
  the controller's 400 is the correct behaviour.
