# Implementation Plan — Per-Plugin Connection Config + Credentials Validators (#586 + #587)

**Branch:** `586-587-typed-connection-config-and-credentials`
**Parent:** [#551 Modularity Thread E](https://github.com/openlinker-project/openlinker/issues/551)
**Issues:** [#586](https://github.com/openlinker-project/openlinker/issues/586), [#587](https://github.com/openlinker-project/openlinker/issues/587)

---

## 1. Goal

Remove the two remaining `platformType === '…'` / `Record<string, validator>` switches from the API's `ConnectionService` and migrate per-plugin config + credentials shape validation onto the existing host-side registry pattern (mirrors `ConnectionTesterRegistryService`, `WebhookProvisioningRegistryService`, `RetryClassifierRegistryService` post-#581 / #583).

Concretely:
- **#586** — `validateCredentialsShape(platformType, …)` (`apps/api/src/integrations/application/credentials/credential-shape.validator.ts`) currently hard-codes `if (platformType === 'prestashop')`. `CONNECTION_CONFIG_VALIDATORS` (`apps/api/src/integrations/application/services/util/connection-config-validators.ts`) is a hard-coded `Record<'allegro'|'prestashop', Validator>`. Both have to be edited every time a plugin is added.
- **#587** — `CreateConnectionDto.config` and `UpdateConnectionDto.config` are typed `Record<string, unknown>` at the HTTP boundary. The recommendation explicitly *accepts* the dynamic JSONB shape and replaces the inline switch with **registry-driven per-plugin validators** (option B in the issue). The JSON-Schema endpoint is out of scope (no FE consumer asks for it today).

Both issues collapse into one cohesive refactor on the same call sites.

**Layer:** Mostly CORE (`libs/core/src/integrations` — two new ports + two new registries) + SDK (`libs/plugin-sdk` — `HostServices` extension) + two integration packages (Allegro, PrestaShop) + API consumer (`ConnectionService`).

---

## 2. Non-goals

- **No HTTP DTO shape change** (#587 §"replace `Record` with `Record`"). `CreateConnectionDto.config` and `UpdateConnectionDto.config` stay `Record<string, unknown>` — the registry IS the per-plugin typed-shape contract. Discriminated DTOs would re-introduce the very `platformType` switch we're removing.
- **No JSON-Schema endpoint** (`GET /connections/config-schema/:adapterKey`). Defer until a FE consumer (form-generation, schema-driven admin UI) asks for it. The registry already accommodates the addition — just unblock the open seam.
- **No change to `Connection.config` *entity* typing.** The persisted JSONB blob stays freeform. The validators run at the create/update boundary; downstream readers (adapters) cast to their own typed shape after the registry-driven check has passed.
- **No change to `AllegroAdapterFactory.resolveCredentials` / `PrestashopAdapterFactory.resolveCredentials`** — those run on adapter construction, separately from shape validation at the connection-create boundary. Today only PrestaShop ships a shape-only check; this PR moves it without changing semantics.

---

## 3. Current state (verified)

```
apps/api/src/integrations/application/credentials/credential-shape.validator.ts:13-25
  — `validateCredentialsShape(platformType: string, credentials)`. One branch:
    `if (platformType === 'prestashop')` checks `credentials.webserviceApiKey`.
  — Called from `connection.service.ts:161` (create) and `:341` (rotate).

apps/api/src/integrations/application/services/util/connection-config-validators.ts:62-65
  — `CONNECTION_CONFIG_VALIDATORS: Record<string, ConnectionConfigValidator>`
    = { allegro, prestashop }
  — Each validator does `plainToInstance + validate` against a per-platform DTO.
  — Called from `connection.service.ts:149` (create) and `:312` (update).

apps/api/src/integrations/application/dto/{allegro,prestashop}-connection-config.dto.ts
  — Per-platform DTOs. Only consumer is the validator file above.

libs/core/src/integrations/infrastructure/adapters/
  connection-tester-registry.service.ts                          ← reference pattern
  webhook-provisioning-registry.service.ts                       ← reference pattern
  email-normalizer-registry.service.ts                           ← reference pattern

libs/plugin-sdk/src/host-services.ts
  — Already exposes `connectionTesterRegistry`, `webhookProvisioningRegistry`,
    `emailNormalizerRegistry`, `retryClassifierRegistry`, `schedulerTaskRegistry`,
    `adapterRegistry`, `factoryResolver`. The two new registries slot in here.
```

Verified no external (cross-package) consumer of either `validateCredentialsShape` or `CONNECTION_CONFIG_VALIDATORS` — they live in `apps/api/` and only `ConnectionService` references them.

---

## 4. Design

### 4.1 Two new ports + two new registries (CORE)

Mirroring `ConnectionTesterPort` / `ConnectionTesterRegistryService`:

```ts
// libs/core/src/integrations/domain/ports/connection-config-validator.port.ts
export interface ConnectionConfigShapeValidatorPort {
  validate(config: Record<string, unknown>): Promise<void>;  // throws on invalid shape
}

// libs/core/src/integrations/domain/ports/connection-credentials-validator.port.ts
export interface ConnectionCredentialsShapeValidatorPort {
  validate(credentials: Record<string, unknown>): void;  // throws on invalid shape
}

// libs/core/src/integrations/infrastructure/adapters/connection-config-validator-registry.service.ts
@Injectable()
export class ConnectionConfigShapeValidatorRegistryService {
  private readonly validators = new Map<string, ConnectionConfigShapeValidatorPort>();
  register(adapterKey: string, validator: ConnectionConfigShapeValidatorPort): void { … }
  get(adapterKey: string): ConnectionConfigShapeValidatorPort | undefined { … }
  has(adapterKey: string): boolean { … }
}

// libs/core/src/integrations/infrastructure/adapters/connection-credentials-validator-registry.service.ts
@Injectable()
export class ConnectionCredentialsShapeValidatorRegistryService { … same shape … }
```

**Keying decision:** by `adapterKey`, not `platformType`. The existing registries (`ConnectionTesterRegistryService`, `WebhookProvisioningRegistryService`) all key by `adapterKey`, and a future second adapter for the same `platformType` (e.g. `prestashop.graphql.v1` alongside `prestashop.webservice.v1`) could ship a different config/credentials shape. The current `ConnectionService` already resolves `adapterKey` from `(platformType, optional adapterKey override)` upstream — the validator lookup just rides that resolution.

**Validation timing for create:** today the create path calls the validator with `rest.platformType` (the operator's raw input). We must resolve adapterKey *before* the validator lookup. The flow becomes:

```ts
const metadata = await this.integrationsService.resolveAdapterMetadata({
  platformType: rest.platformType,
  adapterKey: rest.adapterKey,
});
// Capability check uses metadata.supportedCapabilities; already exists today.
const configValidator = this.configValidatorRegistry.get(metadata.adapterKey);
if (rest.config !== undefined && configValidator) {
  await configValidator.validate(rest.config);
}
```

The update path already resolves `existing.platformType` via `connectionPort.get(connectionId)`; same `resolveAdapterMetadata` call gives us adapterKey there too.

**Credentials validation timing:** unchanged — runs at create + rotate. Same `adapterKey` resolution.

### 4.2 `HostServices` extension (plugin-sdk)

Add two new fields to `HostServices`:

```ts
readonly connectionConfigValidatorRegistry: ConnectionConfigShapeValidatorRegistryService;
readonly connectionCredentialsValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService;
```

Mirrors `connectionTesterRegistry` exactly. Documented in the JSDoc block that already exists.

### 4.3 Plugin self-registration

Each integration package's plugin descriptor's `register(host)` method gains the new calls:

```ts
// allegro-plugin.ts
register(host) {
  host.connectionTesterRegistry.register('allegro.publicapi.v1', new AllegroConnectionTesterAdapter());
  host.emailNormalizerRegistry.register(…);
  host.retryClassifierRegistry.register(…);
  host.connectionConfigValidatorRegistry.register(
    'allegro.publicapi.v1',
    new AllegroConnectionConfigValidator(),  // implements ConnectionConfigShapeValidatorPort
  );
  // Allegro has no credentials shape check today — that ships from AllegroAdapterFactory.resolveCredentials.
}

// prestashop-plugin.ts
register(host) {
  host.connectionTesterRegistry.register('prestashop.webservice.v1', new PrestashopConnectionTesterAdapter());
  host.webhookProvisioningRegistry.register(…);
  host.connectionConfigValidatorRegistry.register(
    'prestashop.webservice.v1',
    new PrestashopConnectionConfigValidator(),
  );
  host.connectionCredentialsValidatorRegistry.register(
    'prestashop.webservice.v1',
    new PrestashopCredentialsShapeValidator(),
  );
}
```

The validators are concrete classes in each plugin package, implementing the port interface.

### 4.4 DTO migration

- `AllegroConnectionConfigDto` → `libs/integrations/allegro/src/domain/dto/allegro-connection-config.dto.ts`.
- `PrestashopConnectionConfigDto` → `libs/integrations/prestashop/src/domain/dto/prestashop-connection-config.dto.ts`.

The DTOs are part of the plugin's public surface (they describe the plugin's typed config shape). Moving them into the plugin package puts them where new plugin authors expect them, and lets the plugin's validator import its own DTO without crossing the API boundary.

The new validator classes (`AllegroConnectionConfigValidator`, `PrestashopConnectionConfigValidator`) live in `libs/integrations/<plugin>/src/application/` next to the existing factory. They use `plainToInstance` + `validate` exactly like the old API-layer functions — semantics preserved.

### 4.5 API-layer deletion

After the migration:
- Delete `apps/api/src/integrations/application/credentials/credential-shape.validator.ts` + its spec.
- Delete `apps/api/src/integrations/application/services/util/connection-config-validators.ts`.
- Delete `apps/api/src/integrations/application/dto/{allegro,prestashop}-connection-config.dto.ts`.
- `ConnectionService` imports the two new registries via Symbol tokens, looks up validators by `adapterKey`, calls `.validate(...)`.

The `flatten-validation-errors` util (`apps/api/src/integrations/application/services/util/flatten-validation-errors.ts`) is reusable across plugin validators — move it to `libs/core/src/integrations/` or duplicate per plugin? Decision: move to `libs/core/src/integrations/application/util/` so all plugins can use the same flattener. It has no platform-specific logic.

### 4.6 NestJS module wiring

Add the two new registry services to `IntegrationsModule.providers` and `exports`. Bind them to Symbol tokens (per engineering-standards.md "Why Symbol tokens?"). Plugins import the registries via the `HostServices` bag at `register(host)` — they don't `@Inject` directly.

---

## 5. Step-by-step

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/integrations/domain/ports/connection-config-validator.port.ts` (new) | Define `ConnectionConfigShapeValidatorPort` | Compiles |
| 2 | `libs/core/src/integrations/domain/ports/connection-credentials-validator.port.ts` (new) | Define `ConnectionCredentialsShapeValidatorPort` | Compiles |
| 3 | `libs/core/src/integrations/infrastructure/adapters/connection-config-validator-registry.service.ts` (new) | `@Injectable` registry mirroring `ConnectionTesterRegistryService` | Spec passes |
| 4 | `libs/core/src/integrations/infrastructure/adapters/connection-credentials-validator-registry.service.ts` (new) | Same shape, different port type | Spec passes |
| 5 | `libs/core/src/integrations/infrastructure/adapters/__tests__/connection-config-validator-registry.service.spec.ts` (new) | register / get / has + duplicate-key acceptance test (no-op overwrite; consistent with other registries) | Green |
| 6 | `libs/core/src/integrations/infrastructure/adapters/__tests__/connection-credentials-validator-registry.service.spec.ts` (new) | Same | Green |
| 7 | `libs/core/src/integrations/integrations.tokens.ts` | Add `CONNECTION_CONFIG_VALIDATOR_REGISTRY_TOKEN` + `CONNECTION_CREDENTIALS_VALIDATOR_REGISTRY_TOKEN` | Type-check |
| 8 | `libs/core/src/integrations/integrations.module.ts` | Provide + export both registries via Symbol tokens | App boots |
| 9 | `libs/core/src/integrations/index.ts` | Export the two ports + the two registry services + the two new tokens | Type-check |
| 10 | `libs/core/src/integrations/application/util/flatten-validation-errors.ts` (new) | Move `flattenValidationErrors` from API → core util. Existing API consumer continues to import via barrel. | Spec passes |
| 11 | `libs/core/src/integrations/application/util/flatten-validation-errors.spec.ts` (new) | Migrate existing spec from `apps/api/.../util/` | Green |
| 12 | `libs/plugin-sdk/src/host-services.ts` | Add `connectionConfigValidatorRegistry` + `connectionCredentialsValidatorRegistry` fields with JSDoc | Type-check |
| 13 | `libs/integrations/allegro/src/domain/dto/allegro-connection-config.dto.ts` (move from `apps/api`) | Move DTO file as-is | Type-check |
| 14 | `libs/integrations/allegro/src/application/allegro-connection-config.validator.ts` (new) | Implements `ConnectionConfigShapeValidatorPort` — wraps existing `plainToInstance + validate` against `AllegroConnectionConfigDto` | Spec passes |
| 15 | `libs/integrations/allegro/src/application/__tests__/allegro-connection-config.validator.spec.ts` (new) | Migrate existing test cases from `connection-config-validators.spec.ts` (Allegro slice only) | Green |
| 16 | `libs/integrations/allegro/src/allegro-plugin.ts` | `register(host)` gains `host.connectionConfigValidatorRegistry.register('allegro.publicapi.v1', new AllegroConnectionConfigValidator())` | Plugin-spec passes |
| 17 | `libs/integrations/allegro/src/index.ts` | Re-export `AllegroConnectionConfigDto` + `AllegroConnectionConfigValidator` from the barrel | Type-check |
| 18 | `libs/integrations/prestashop/src/domain/dto/prestashop-connection-config.dto.ts` (move from `apps/api`) | Move DTO file as-is | Type-check |
| 19 | `libs/integrations/prestashop/src/application/prestashop-connection-config.validator.ts` (new) | Implements `ConnectionConfigShapeValidatorPort` | Spec passes |
| 20 | `libs/integrations/prestashop/src/application/prestashop-credentials-shape.validator.ts` (new) | Implements `ConnectionCredentialsShapeValidatorPort`; checks `webserviceApiKey` (semantics preserved from current API-layer impl) | Spec passes |
| 21 | `libs/integrations/prestashop/src/application/__tests__/prestashop-connection-config.validator.spec.ts` + `prestashop-credentials-shape.validator.spec.ts` (new) | Migrate existing tests | Green |
| 22 | `libs/integrations/prestashop/src/prestashop-plugin.ts` | `register(host)` gains both registrations | Plugin-spec passes |
| 23 | `libs/integrations/prestashop/src/index.ts` | Re-export the DTO + both validator classes | Type-check |
| 24 | `apps/api/src/integrations/application/services/connection.service.ts` | Replace `validateCredentialsShape(rest.platformType, …)` / `CONNECTION_CONFIG_VALIDATORS[rest.platformType]?.()` with adapterKey-resolved registry lookups (3 sites: create, update, rotate). Resolve adapterKey via existing `resolveAdapterMetadata({ platformType, adapterKey })` already called for the capability check. | Existing spec passes (with mocks updated) |
| 25 | `apps/api/src/integrations/application/services/connection.service.spec.ts` | Replace static-Record + `validateCredentialsShape` mocks with registry mocks (`jest.Mocked<ConnectionConfigShapeValidatorRegistryService>` etc.) | All cases green |
| 26 | DELETE `apps/api/src/integrations/application/credentials/credential-shape.validator.ts` + `.spec.ts` | Behavior preserved in PrestaShop plugin | Type-check |
| 27 | DELETE `apps/api/src/integrations/application/services/util/connection-config-validators.ts` + `.spec.ts` | Behavior preserved in plugin validators | Type-check |
| 28 | DELETE `apps/api/src/integrations/application/services/util/flatten-validation-errors.ts` + `.spec.ts` (moved to core in step 10) | API still imports via `@openlinker/core/integrations` if needed | Type-check |
| 29 | DELETE `apps/api/src/integrations/application/dto/allegro-connection-config.dto.ts` + `prestashop-connection-config.dto.ts` | Moved to plugins | Type-check |
| 30 | `docs/architecture-overview.md` § 10 "Plugin Manager / Integrations" | Add a bullet documenting the two new registries (mirrors the static-manifest / dispatch-capability bullets added in #652) | Doc reflects new seams |

Final quality gate: `pnpm lint && pnpm type-check && pnpm test`.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `Connection.config` semantics change — operators relying on missing-validator skip get stricter validation | Same as today: registry returns `undefined` → skip the check. No semantic change. The validator only fires when a plugin registers one. |
| Adapter-key resolution needs to happen *before* validation on `create`. If we resolve metadata first and validation fails, the adapter-metadata lookup may have side effects (logging, registry hit) | The existing `IntegrationsService.resolveAdapterMetadata` is a pure read against the registry — no side effects on the failure path. The current code already does this lookup before validation for the capability check (`connection.service.ts:128`), so we're just sharing the result. |
| DTO migration from `apps/api` to `libs/integrations/*` — circular import risk if `libs/integrations` types import from `apps/api/dto` | Verified at grep: only the API validator file imports the DTOs. After move, no cross-package import remains. |
| `flatten-validation-errors` is in `apps/api/src/integrations/application/services/util/` — moving to core risks breaking a hidden consumer | Verified: only consumer is `connection-config-validators.ts`, which is also being deleted in this PR. Safe move. |
| `webserviceApiKey` shape check on PrestaShop is currently in API; moving to plugin could change error-path classification | Same `BadRequestException` from `@nestjs/common`. Re-exported via the plugin package — message and HTTP status preserved. |
| Tests in `apps/api/test/integration/` may register fixtures that bypass the registries | Verified: int-spec `connection-create.int-spec.ts` and `connection-rotate-credentials.int-spec.ts` go through the full Nest module graph and use the real plugin registrations. They'll exercise the new registries automatically. |

---

## 7. Out of scope / follow-ups

- **JSON-Schema endpoint** (`GET /connections/config-schema/:adapterKey`) — FE-driven follow-up; the registry-driven validator unblocks it.
- **Per-plugin credentials DTOs** — Allegro's credentials shape is validated inside `AllegroAdapterFactory.resolveCredentials` (already plugin-local). PrestaShop ships a one-field check today. A future refactor could promote both to DTO-driven validation, but that's a structural change to the credentials layer, not the modularity-blocking switch this PR removes.
- **Discriminated `CreateConnectionDto.config`** — explicitly *rejected* in §2 because it would re-introduce a core switch on `platformType`. The registry IS the typed-shape contract.

---

## 8. Open questions

None. Both issues have unambiguous "mirror `ConnectionTesterRegistryService`" recommendations and the file paths are verified post-#652.
