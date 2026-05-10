# Implementation plan — open `Capability` and `EntityType` unions (#576 + #577)

Closes: #576 (D1) and #577 (D2). Tracks: #550 / #546.

## 1. Goal & non-goals

**Goal.** Close two doc-vs-code drifts that block plugin authors from extending OpenLinker without forking core:

- **#576 D1.** `Capability` is a closed `as const` union. The architecture doc lists `PricingAuthorityPort`, `ShippingProviderManagerPort`, `PaymentProcessorPort` as future capabilities. A plugin that introduces a new capability today must edit `libs/core/src/integrations/domain/types/adapter.types.ts`.
- **#577 D2.** `EntityType` is a closed union of seven values. The architecture doc says the port signature is `entityType: 'Product' | … | 'Customer' | string` — already documented as open. The code regressed against its own contract.

The shape both issues recommend, applied literally:

- Keep the well-known list as a closed `as const` + derived union, renamed `Core*` so its scope is explicit.
- Widen the **boundary signatures** (port methods, adapter-metadata fields, registry calls) — not the type alias — by typing those parameters/fields as `CoreCapability | string` or `CoreEntityType | string`. This matches `architecture-overview.md` line 529 verbatim (`entityType: 'Product' | … | string`), and matches #576's "treat `Capability` as `string` at the registry boundary" and #577's "widen the parameter type to `EntityType | string`".
- Validate against runtime metadata where it matters. The `IntegrationsService.getCapabilityAdapter` runtime gate already rejects unsupported capabilities; we keep it.
- Keep the HTTP DTO surface strict on `CoreCapabilityValues` for now via `@IsIn(...)`. The DTO is the immediate-feedback validation boundary an operator sees in the UI; loosening it without a runtime-aware validator regresses UX. File a follow-up issue for the runtime-aware DTO validator.

This avoids the `Core* | (string & {})` autocomplete idiom: it collapses to `string` for assignability anyway, while obscuring intent at the type level. The boundary-only widening is the architecturally honest version.

**Layer.** Backend — `libs/core` (domain + application) + `apps/api` (HTTP DTOs + a couple of comments) + `apps/web` (mirrored types).

**Non-goals.**
- *No* `registerEntityType(name, { idPrefix })` extension hook — explicitly listed as an optional follow-up in #577. We close the doc-vs-code drift now; a richer extension API is its own issue.
- *No* changes to listings sub-capabilities (`OfferLister`, `OfferCreator`, etc.). They already use the structural-typing + type-guard pattern #576 holds up as the model. Aligning the top-level `Capability` system to that same shape is a separate refactor and out of scope here.
- *No* DB migration. `connections.enabled_capabilities` and `identifier_mappings.entity_type` are already `text[]` / `text` in Postgres; widening the TypeScript type does not change the wire shape.
- *No* changes to FE platform-switch dispatch (`=== 'allegro'`, etc., #579 D4). The widening here makes those switches *more* likely to silently accept new strings; #579 owns the structural fix.

## 2. Existing patterns we lean on

- **Sub-capabilities (`libs/core/src/listings/domain/ports/capabilities/*.capability.ts`).** Each is a free-standing interface + co-located `is{Capability}(adapter)` type guard. Adapters declare `implements OfferManagerPort, OfferLister, OfferCreator, …`; call sites narrow via the guard. No central enum. This is the model #576 explicitly points at.
- **Runtime capability check.** `IntegrationsService.getCapabilityAdapter` already verifies `metadata.supportedCapabilities.includes(capability)` and throws `CapabilityNotSupportedException` when missing. This is the canonical runtime gate — we keep it; we just stop also gating at compile time on the *registry* boundary.
- **`as const` + union pattern.** Engineering Standards § "Union Types: `as const` Pattern" already documents the runtime-array-plus-derived-type shape. We keep it intact for the well-known set (`CoreCapabilityValues` → `CoreCapability`); we do *not* widen the type alias itself.
- **`Partial<Record<…, …>>` for sparse override maps.** `ENTITY_TYPE_ID_PREFIX` already has the right shape (`Partial<Record<EntityType, string>>`). We keep that constraint — it correctly types `lookup[unknownKey]` as `string | undefined`, which the existing `?? entityType.toLowerCase()` fallback already handles. Plugin-registered prefixes flow through the deferred `registerEntityType` hook, not through type-system capitulation.

## 3. Design

### 3.1 `Capability` (#576)

`libs/core/src/integrations/domain/types/adapter.types.ts`:

```ts
/** Well-known core capabilities. The published, documented set. */
export const CoreCapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
] as const;

/**
 * Closed type for the well-known core capabilities.
 *
 * Use `CoreCapability` where exhaustiveness or strict validation matters
 * (HTTP DTOs, FE dropdowns). Use `CoreCapability | string` at extension
 * boundaries (adapter metadata, integrations service) where plugin
 * adapters can register additional capability names.
 */
export type CoreCapability = (typeof CoreCapabilityValues)[number];

/**
 * Adapter metadata.
 *
 * `supportedCapabilities` is `(CoreCapability | string)[]` so plugin adapters
 * can register capability names beyond the core set without editing core.
 * The runtime gate at `IntegrationsService.getCapabilityAdapter` validates
 * the requested capability against this array — it is the source of truth
 * for "is this capability supported", regardless of whether the name is in
 * `CoreCapabilityValues`.
 */
export interface AdapterMetadata {
  adapterKey: string;
  platformType: string;
  supportedCapabilities: (CoreCapability | string)[];
  displayName?: string;
  version?: string;
}
```

**Boundary signatures widen, alias stays closed.** Concretely:

| Surface | Before | After |
|---|---|---|
| `AdapterMetadata.supportedCapabilities` | `Capability[]` | `(CoreCapability \| string)[]` |
| `Connection.enabledCapabilities` (domain entity + types) | `Capability[]` | `(CoreCapability \| string)[]` |
| `IntegrationsService.getCapabilityAdapter(connectionId, capability)` | `Capability` | `CoreCapability \| string` |
| `IntegrationsService.listCapabilityAdapters({ capability })` | `Capability` | `CoreCapability \| string` |
| `AdapterFactoryPort.createCapabilityAdapter(... capability)` | `Capability` | `CoreCapability \| string` |
| `CapabilityNotSupportedException`, `CapabilityNotEnabledException` constructor `capability` | `Capability` | `CoreCapability \| string` |
| HTTP request DTOs (`enabledCapabilities` field type) | `Capability[]` | `CoreCapability[]` (stays strict) |
| HTTP request DTOs `@IsIn(...)` | `@IsIn(CapabilityValues, ...)` | `@IsIn(CoreCapabilityValues, ...)` (stays strict) |
| HTTP response DTO `enabledCapabilities`, `supportedCapabilities` | `Capability[]` | `(CoreCapability \| string)[]` |
| Swagger `@ApiProperty enum:` (request + response) | `enum: CapabilityValues` | `enum: CoreCapabilityValues` (rename only) |

The DTOs stay `@IsIn(CoreCapabilityValues, { each: true })`. An operator typo'ing `'productMaster'` (lowercase) gets immediate API feedback today and continues to. A plugin-registered capability would hit the DTO wall first; that case does not exist today, and unblocking it is the scope of a follow-up issue ("runtime-aware DTO validator that consults the resolved adapter's `supportedCapabilities`").

Swagger `enum:` stays on both request and response — the API today emits and accepts only the well-known set, and that's what the OpenAPI contract should advertise.

### 3.2 `EntityType` (#577)

`libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts`:

```ts
/** Well-known core entity types. The published, documented set. */
export const CoreEntityTypeValues = [
  'Product',
  'ProductVariant',
  'Sku',
  'Order',
  'Offer',
  'Inventory',
  'Customer',
] as const;

/**
 * Closed type for the well-known core entity types.
 *
 * Use `CoreEntityType` where exhaustiveness matters (e.g. literal comparisons
 * against `'Offer'` or `'Product'`). Use `CoreEntityType | string` at port
 * boundaries (e.g. `IdentifierMappingService.getOrCreateInternalId`) where
 * plugin adapters may map additional entity types like `Refund`,
 * `Fulfilment`, `Subscription`.
 */
export type CoreEntityType = (typeof CoreEntityTypeValues)[number];

/**
 * Internal-ID prefix overrides for entity types whose default
 * lowercased prefix is undesirable.
 *
 * `Partial<Record<CoreEntityType, string>>` — only well-known entity types
 * may have prefix overrides registered here today. The lookup type is
 * `string | undefined`, which the existing `?? entityType.toLowerCase()`
 * fallback in `IdentifierMappingService.generateInternalId` handles.
 *
 * Plugin-registered entity types fall through to the lowercased default.
 * A future `registerEntityType(name, { idPrefix? })` extension hook (see
 * #577 follow-up) will be the supported way for plugins to register
 * non-default prefixes.
 */
export const ENTITY_TYPE_ID_PREFIX: Partial<Record<CoreEntityType, string>> = {
  ProductVariant: 'variant',
};
```

**Boundary signatures widen, alias stays closed.** Concretely:

| Surface | Before | After |
|---|---|---|
| `IdentifierMappingQueryPort.getInternalId(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingQueryPort.getExternalIds(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingQueryPort.listExternalIdsByConnection(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingCommandPort.getOrCreateInternalId(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingCommandPort.createMapping(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingCommandPort.batchGetOrCreateInternalIds(requests)` (`request.entityType`) | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingCommandPort.getOrCreateExactMapping(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingCommandPort.deleteMapping(entityType, ...)` | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingRequest.entityType` | `EntityType` | `CoreEntityType \| string` |
| Repository port methods + `IdentifierMappingRepository` impl | `EntityType` | `CoreEntityType \| string` |
| `IdentifierMappingService` private/public methods | `EntityType` | `CoreEntityType \| string` |
| `OFFER_ENTITY_TYPE` constant in `offer-mapping.repository.ts` | `EntityType = 'Offer'` | `CoreEntityType = 'Offer'` |
| `entity.entityType as EntityType` cast on the same file | `as EntityType` | `as CoreEntityType` (kept; load-bearing for downstream narrowing) |
| `ExternalIdMapping.entityType` | already `string` | unchanged |

The cast at `offer-mapping.repository.ts:110` is **kept** under the renamed name. With `EntityType` previously closed, the cast was already a documented widening from the ORM's untyped `string` column to the `EntityType` domain type; now that `CoreEntityType` is also closed, the cast still narrows from `string` to the well-known set and downstream literal comparisons (`mapping.entityType === 'Offer'`) keep working. Dropping it would require widening every downstream consumer to `CoreEntityType | string`, which is a non-goal here.

`webhook-to-job.handler.ts` PascalCase normalisation comments (lines 336 and 427) get a one-line update: "match the well-known core entity types" instead of "match EntityType enum values" — the PascalCase normalisation itself is still useful; it's just no longer load-bearing for type-checking.

### 3.3 Frontend mirror

`apps/web/src/features/connections/api/connections.types.ts` has its own `CAPABILITY_VALUES` / `Capability`. Apply the same shape:

```ts
export const CORE_CAPABILITY_VALUES = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
] as const;

export type CoreCapability = (typeof CORE_CAPABILITY_VALUES)[number];
```

`Connection.enabledCapabilities` and `Connection.supportedCapabilities` widen to `(CoreCapability | string)[]` — the FE displays whatever the API returns. `CreateConnectionInput.enabledCapabilities` and `UpdateConnectionInput.enabledCapabilities` stay strict (`CoreCapability[]`), mirroring the BE request DTO contract. `adapters.api.types.ts` (`supportedCapabilities`) widens. The `requiredCapability?` in `trigger-sync-dialog.types.ts` stays `CoreCapability` — it gates UI dispatch on well-known names only.

The FE has no analog of `EntityType` (only the backend side maps identifiers).

**Out of scope.** D4 (#579) calls out FE platform-switch dispatch (`=== 'allegro'`-style equality). The capability widening here makes that class of bug *more* likely to silently accept plugin-registered capability names; #579 owns the structural fix (capability-shaped wizard, registry-driven dispatch). Anything new written in this PR that touches `Capability` should use `CORE_CAPABILITY_VALUES.includes(...)` runtime checks rather than `=== 'OrderSource'` equality.

## 4. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/integrations/domain/types/adapter.types.ts` | Rename `CapabilityValues` → `CoreCapabilityValues`, `Capability` (alias) → `CoreCapability`. Update `AdapterMetadata.supportedCapabilities` to `(CoreCapability \| string)[]` with explanatory JSDoc. | `pnpm type-check` passes; `AdapterMetadata['supportedCapabilities']` accepts `['PricingAuthority']` literal. |
| 2 | `libs/core/src/integrations/index.ts` | Replace `Capability, CapabilityValues` exports with `CoreCapability, CoreCapabilityValues`. | Barrel exports the new names; old names gone. |
| 3 | `libs/core/src/integrations/application/services/integrations.service.ts` + `application/interfaces/integrations.service.interface.ts` | Replace `Capability` with `CoreCapability \| string` in method signatures (`getCapabilityAdapter`, `listCapabilityAdapters` filter, return-type `capability` field). Imports update. Behaviour unchanged. | Compiles; `getCapabilityAdapter(id, 'PricingAuthority')` typechecks. |
| 4 | `libs/core/src/integrations/domain/ports/adapter-factory.port.ts` + `infrastructure/adapters/adapter-factory-resolver.service.ts` + `infrastructure/adapters/adapter-registry.service.ts` | Same widening at the factory + registry boundary. The two `as Capability[]` casts in `adapter-registry.service.ts:35,42` become unnecessary — drop them. | Compiles; explicit casts removed. |
| 5 | `libs/core/src/integrations/domain/exceptions/capability-not-supported.exception.ts` + `capability-not-enabled.exception.ts` | Constructor `capability` parameter type widens to `CoreCapability \| string`. Imports update. | Compiles. |
| 6 | `libs/core/src/identifier-mapping/domain/entities/connection.entity.ts` + `domain/types/connection.types.ts` | `Connection.enabledCapabilities: (CoreCapability \| string)[]`. `CreateConnectionParams` / `UpdateConnectionParams` `enabledCapabilities`: same. Import updates. | Compiles. |
| 7 | `libs/core/src/identifier-mapping/infrastructure/persistence/repositories/connection.repository.ts` | Update import to `CoreCapability`. The repository already passes the array through unchanged; widening flows transparently. | Compiles. |
| 8 | `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts` | Rename `EntityTypeValues` → `CoreEntityTypeValues`, `EntityType` → `CoreEntityType`. Keep `ENTITY_TYPE_ID_PREFIX: Partial<Record<CoreEntityType, string>>` (constraint unchanged, just renamed). Widen `IdentifierMappingRequest.entityType` to `CoreEntityType \| string`. | Compiles. |
| 9 | `libs/core/src/identifier-mapping/index.ts` | Replace `EntityType, EntityTypeValues` exports with `CoreEntityType, CoreEntityTypeValues`. | Barrel exports the new names. |
| 10 | `libs/core/src/identifier-mapping/domain/ports/identifier-mapping.port.ts` + `domain/ports/identifier-mapping-repository.port.ts` | Widen every `entityType: EntityType` parameter to `entityType: CoreEntityType \| string`. Update imports. | Compiles; ports accept arbitrary strings. |
| 11 | `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts` + `infrastructure/persistence/repositories/identifier-mapping.repository.ts` + `domain/entities/identifier-mapping.entity.ts` | Same widening on impl + entity. `generateInternalId(entityType: CoreEntityType \| string)` — its `ENTITY_TYPE_ID_PREFIX[entityType]` lookup is now indexing a `Partial<Record<CoreEntityType, string>>` with a `CoreEntityType \| string` key. TS narrows correctly because the lookup just needs the `string` index signature; the `?? entityType.toLowerCase()` fallback covers the `undefined` branch. | Compiles; existing behaviour unchanged for well-known types; new types fall through to lowercased default. |
| 12 | `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts` | Rename `EntityType` import to `CoreEntityType`. `OFFER_ENTITY_TYPE: CoreEntityType = 'Offer'`. The cast `entity.entityType as CoreEntityType` is kept (load-bearing for downstream literal narrowing). | Compiles. |
| 13 | `apps/api/src/listings/http/listings.controller.ts` | Update the `import type { EntityType, ... }` to `CoreEntityType`. The two `('Offer' satisfies EntityType)` checks become `('Offer' satisfies CoreEntityType)`. | Compiles. |
| 14 | `apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts` | Update the two comments referencing "EntityType enum" to "well-known core entity types". No type changes. | Comments accurate; behaviour unchanged. |
| 15 | `apps/api/src/integrations/http/dto/create-connection.dto.ts` + `update-connection.dto.ts` | Update imports `CapabilityValues` → `CoreCapabilityValues`, `Capability` → `CoreCapability`. Keep `@IsIn(CoreCapabilityValues, { each: true })` strict. Keep `enum: CoreCapabilityValues` in `@ApiProperty`. Field type stays `CoreCapability[]`. | Compiles; DTO still rejects non-well-known capabilities at the API. |
| 16 | `apps/api/src/integrations/http/dto/connection-response.dto.ts` | Update imports. Field types widen to `(CoreCapability \| string)[]` (mirrors the entity). Keep `enum: CoreCapabilityValues` in `@ApiProperty` — that documents what the server emits today; FE codegen pinning against it is correct. | Swagger response shape unchanged for current clients; type accepts plugin values when they exist. |
| 17 | `apps/api/test/integration/connection-capabilities.int-spec.ts` | Update import of `CapabilityValues`/`Capability` to the new names if used. | int-spec compiles + still passes. |
| 18 | `apps/web/src/features/connections/api/connections.types.ts` | Rename `CAPABILITY_VALUES` → `CORE_CAPABILITY_VALUES`, `Capability` → `CoreCapability`. Widen `Connection.{enabled,supported}Capabilities` to `(CoreCapability \| string)[]`. Keep `Create/UpdateConnectionInput.enabledCapabilities` strict (`CoreCapability[]`) to mirror the BE request DTO. | FE compiles. |
| 19 | `apps/web/src/features/adapters/api/adapters.types.ts` + `connections/components/ConnectionCapabilitiesPanel.tsx` + `connections/components/prestashop-setup.schema.ts` + `connections/components/prestashop-setup-form.tsx` + `sync-jobs/components/trigger-sync-dialog.types.ts` | Sweep: rename imports. `adapters.types.ts` widens `supportedCapabilities` to `(CoreCapability \| string)[]`. `trigger-sync-dialog.types.ts` `requiredCapability?` stays `CoreCapability` (UI gates on well-known names only). `ConnectionCapabilitiesPanel` + `prestashop-setup.*` use `CoreCapability` for editor-mode strictness. | FE compiles; runtime renders unchanged. |
| 20 | New unit test: `libs/core/src/integrations/domain/types/__tests__/adapter.types.spec.ts` | Concrete behavioural assertions — see §5.2. | `pnpm test` passes. |
| 21 | New unit test: `libs/core/src/identifier-mapping/domain/types/__tests__/identifier-mapping.types.spec.ts` | Concrete behavioural assertions — see §5.2. | `pnpm test` passes. |
| 22 | `docs/architecture-overview.md` | Two surgical edits: (a) §"Identifier Mapping Service / Interface" — replace inline `entityType: 'Product' \| ... \| string` shape with an explicit `entityType: CoreEntityType \| string` referencing the new alias name, so doc + code use the same identifier. (b) §"Capability Abstractions / Future Capability Ports" — append a paragraph noting `Capability` is open at the registry boundary (`CoreCapability \| string`) and plugins do not need a core PR to register a new capability; HTTP DTOs remain strict on `CoreCapabilityValues` until the runtime-aware validator follow-up lands. | Doc + code use the same identifiers. |
| 23 | Final sweep: `grep -rn '\\b(Capability\|CapabilityValues\|EntityType\|EntityTypeValues\|CAPABILITY_VALUES)\\b' apps libs \| grep -v Core` | All remaining hits should be intentional substring matches (e.g. `CapabilityNotSupportedException`, `OfferCreationCapability`, file names). Manual eyeball; no rename mistakes. | Confirmation that the rename is complete. |

## 5. Validation

### 5.1 Architecture & standards compliance

- ✅ Domain has no framework deps — only `*.types.ts`, `*.port.ts`, `*.entity.ts` files in `domain/` are touched.
- ✅ Engineering Standards § "Union Types: `as const` Pattern" preserved literally — `CoreCapabilityValues` + derived `CoreCapability` keeps the runtime-array-plus-derived-type shape; the type alias itself is *not* widened with `(string & {})`. The boundary widening lives on the consuming signatures, where the doc literally documents it.
- ✅ Naming — `Core{Capability,EntityType}{Values,}` mirrors #576's literal recommendation.
- ✅ No deprecation shims — call sites are renamed in the same PR (~30 references across ~20 files).
- ✅ No `any`. The `CoreCapability | string` boundary is documented by name; readers see "well-known core, plus any string."
- ✅ Repository ports / port pattern unchanged structurally — only parameter types widen.
- ✅ Engineering Standards § "Validation" preserved — DTO validation stays strict on `CoreCapabilityValues`. Loosening it would regress operator UX (typos surface at sync-job time, not API time).

### 5.2 Tests

Two new spec files. **Real assertions, not `satisfies` lines.**

`libs/core/src/integrations/domain/types/__tests__/adapter.types.spec.ts`:

- *should expose the documented five well-known capabilities in `CoreCapabilityValues`* — assert `CoreCapabilityValues` deep-equals the literal array `['ProductMaster','InventoryMaster','OrderProcessorManager','OrderSource','OfferManager']`. Regression guard against silent reordering or additions.
- *should accept a non-well-known capability when typed as `CoreCapability \| string`* — assign a plugin-style string `'PricingAuthority'` to a `(CoreCapability | string)[]` array and assert it round-trips through `Array.includes`. The compile-time check is implicit; the runtime check makes the test meaningful in `pnpm test`.
- *should narrow back to `CoreCapability` for well-known values via `CoreCapabilityValues.includes`* — function `isCoreCapability(c: CoreCapability | string): c is CoreCapability { return (CoreCapabilityValues as readonly string[]).includes(c); }` returns `true` for `'ProductMaster'`, `false` for `'PricingAuthority'`. This documents the runtime narrowing pattern call sites should use.

`libs/core/src/identifier-mapping/domain/types/__tests__/identifier-mapping.types.spec.ts`:

- *should expose the documented seven well-known entity types in `CoreEntityTypeValues`* — same shape regression guard.
- *should override the prefix to 'variant' for ProductVariant* — assert `ENTITY_TYPE_ID_PREFIX.ProductVariant === 'variant'`.
- *should fall back to `entityType.toLowerCase()` when `ENTITY_TYPE_ID_PREFIX` has no override* — pull the lookup logic from `IdentifierMappingService.generateInternalId` into a small pure helper or inline-test the expression: `(ENTITY_TYPE_ID_PREFIX[t] ?? t.toLowerCase())` returns `'product'` for `'Product'` (no override) and `'refund'` for `'Refund'` (plugin entity type, also no override).
- *should accept a non-well-known entity type when typed as `CoreEntityType \| string`* — assign `'Refund'` to a `CoreEntityType | string` variable and assert it survives identity round-trips. Documents the boundary-widening intent.

### 5.3 Quality gate

`pnpm lint && pnpm type-check && pnpm test`. Existing unit + integration tests should be unaffected — boundary signatures get *strictly broader*, every existing call site continues to typecheck.

### 5.4 Security

- DTO validation stays strict (`@IsIn(CoreCapabilityValues, { each: true })`). API attack surface unchanged.
- `EntityType` widening has no security surface; it's an in-process identifier-routing type.

### 5.5 Risk

- **Swagger codegen consumers** — no change. Both request and response DTOs keep `enum: CoreCapabilityValues`. External clients pinning against the OpenAPI enum continue to compile.
- **Internal callers passing well-known values** — no change. `'OrderSource'` is still a valid `CoreCapability`, still flows into widened signatures unchanged.
- **Internal callers passing arbitrary strings** — none today; the change unblocks future plugin registration without committing to the registration mechanism in this PR.
- **Doc drift the other way** — step 22 closes it.

## 6. Open questions / follow-ups

1. ~~Deprecation aliases?~~ **Decision: deleted in this PR.**
2. ~~Type alias mechanism?~~ **Decision: boundary widening (`CoreCapability \| string`), not type-alias widening (`CoreCapability \| (string & {})`).** Rationale: matches the literal architecture doc, matches both issues' recommendations word-for-word, doesn't fight the `as const` engineering standard.
3. **Runtime-aware DTO validator.** Out of scope here. File a follow-up under #550 ("`@IsKnownCapabilityForAdapter` validator that consults the resolved adapter's `supportedCapabilities`"). When that lands, the DTO can drop `@IsIn(CoreCapabilityValues, ...)` cleanly.
4. **`registerEntityType(name, { idPrefix? })` extension hook.** Explicitly listed as a follow-up in #577. File a child issue under #550.
5. **Sub-capability pattern asymmetry.** Top-level `Capability` lands on `Core* | string` boundary widening; sub-capabilities use structural typing + `is{Capability}` guards. Both are documented patterns. Whether to unify on the structural pattern is a follow-up under #550 — out of scope here because it would touch every adapter.
6. **FE platform-switch dispatch (#579 D4).** The widening here makes `enabledCapabilities.includes('Foo')` more meaningful and makes `=== 'OrderSource'` more brittle. #579 owns the structural fix. Out of scope here.
