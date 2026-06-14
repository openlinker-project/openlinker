# Implementation Plan: Attribute projection service + attribute_mappings / attribute_value_mappings (#1038)

**Date**: 2026-06-14
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #1038 (epic #1005, ADR-023 §3/§4/§Storage)

---

## 1. Task Summary

**Objective**: Project a product variant's descriptive `attributes` (`Record<string,string>`, e.g. `{ Color: 'Red' }`) into a destination's neutral parameter shape (`ResolvedParameter[]`), resolving dictionary value-ids at projection time from the live category schema, with operator-authored attribute→parameter and value→value mappings persisted in two new tables.

**Context**: After #1050 PrestaShop variants emit semantic attribute names, and WooCommerce already does — so attribute mapping now has a consistent input across sources. Category placement (#1037) is done; the parameter schema (`CategoryParameter`, #1035) carries `multiValue`/`dictionary`/`section`. This is the parameter-population half of cross-platform listing (ADR-023 §3/§4).

**Classification**: CORE (mappings storage + listings projection) + Infrastructure (migration).

---

## 2. Scope & Non-Goals

### In Scope
- `mappings` context: `AttributeMapping` + `AttributeValueMapping` entities, ORM entities (with partial unique indexes), repository port + impl, `IMappingConfigService` read/write methods, token, module wiring, migration `1805000000000`.
- `listings` context: `AttributeProjectionService` (+ interface, token, types), provenance-aware projection, module wiring.
- Unit specs for the service + repository; int-spec for the storage round-trip + partial-index NULL-distinct semantics + value-mapping cascade.

### Out of Scope (Non-Goals)
- Wiring projection into offer creation (#1039).
- Shop `ProductPublisher` capability handling (#1041+).
- HTTP controller / FE authoring surface for attribute mappings — **storage + service now, cockpit later** (same Option-A deferral #1036 used for categories). No controller/DTO in this PR.
- `CategoryResolutionResult` / placement chain (#1037, done).

### Constraints
- Greenfield tables — no data migration/backfill.
- Migration timestamp **must be `1805000000000`** (current tail is `1804000000000`; strictly-greater ordering invariant #1013).

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/mappings` storage; `libs/core/src/listings` projection) + Infrastructure (migration in `apps/api/src/migrations`).

**Capabilities Involved**: `OfferManagerPort` + `CategoryParametersReader` sub-capability (`isCategoryParametersReader` guard) to fetch the live `CategoryParameter[]` for dictionary resolution. Resolved via `IIntegrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`.

**Existing Services Reused**:
- `IMappingConfigService` / `MappingConfigService` — extended with attribute methods (mirrors the category methods exactly).
- `IIntegrationsService` — adapter resolution (same as `CategoryResolutionService`).

**New Components**:
- `mappings`: `AttributeMapping`, `AttributeValueMapping` (domain entities); `AttributeMappingOrmEntity`, `AttributeValueMappingOrmEntity`; `AttributeMappingRepositoryPort` + `AttributeMappingRepository`; `ATTRIBUTE_MAPPING_REPOSITORY_TOKEN`; `AttributeMappingInput` type.
- `listings`: `IAttributeProjectionService` + `AttributeProjectionService`; `ATTRIBUTE_PROJECTION_SERVICE_TOKEN`; `attribute-projection.types.ts` (`AttributeProjectionInput`, `ResolvedParameter`, `AttributeProjectionResult`).

**Core vs Integration Justification**: Both halves are platform-agnostic. Storage is operator config (mappings context owns all mapping tables). Projection consumes the neutral `CategoryParameter` contract + `OfferManagerPort` capability — no platform branching; any destination that implements `CategoryParametersReader` ("owns" its taxonomy) gets dictionary resolution, others get pass-through. Adapters are untouched.

---

## 4. External / Domain Research

### Internal patterns (verified against current main, post #1035/#1036/#1037/#1050)

**Category-mapping stack** (the storage blueprint — mirror exactly):
- Entity `CategoryMapping` (`mappings/domain/entities/category-mapping.entity.ts`) — pure class, positional constructor.
- ORM `category_mappings` (`mappings/infrastructure/persistence/entities/category-mapping.orm-entity.ts`) — two partial unique indexes declared **on the entity** via `@Index(name, [...cols], { unique: true, where: '"col" IS [NOT] NULL' })` (synchronize↔migration parity, the #1036 lesson).
- Repo port `CategoryMappingRepositoryPort` (`findByDestinationConnection`, `findBySourceCategory`, `upsertMapping`, `deleteMapping`); impl uses **find-then-save** upsert with `IsNull()` for the nullable column (TypeORM `ON CONFLICT` can't target partial indexes).
- `IMappingConfigService` category methods + `MappingConfigService` delegate-to-repo.
- `mappings.tokens.ts` (`Symbol('…RepositoryPort')`), `mappings.module.ts` (`TypeOrmModule.forFeature`, `useExisting` token binding, export token + `MappingConfigService`), barrel re-exports tokens/entity/input-type/service-interface.
- Migration `1804000000000-neutralise-category-mappings.ts` — partial-index DDL shape verbatim:
  ```sql
  CREATE UNIQUE INDEX "UQ_category_mappings_src_dest_cat"
    ON "category_mappings" ("source_connection_id","destination_connection_id","source_category_id")
    WHERE "source_connection_id" IS NOT NULL;
  ```

**Listings sibling** `CategoryResolutionService` (`listings/application/services/category-resolution.service.ts`):
- `@Injectable()`, implements `ICategoryResolutionService`, `new Logger(CategoryResolutionService.name)`.
- Ctor: `@Inject(INTEGRATIONS_SERVICE_TOKEN) IIntegrationsService`, `@Inject(MAPPING_CONFIG_SERVICE_TOKEN) IMappingConfigService` (cross-context barrel imports).
- Resolves adapter: `await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`, then narrows with `is*` guards.
- Main barrel `listings/index.ts` = **pure contracts only** (interfaces, types, tokens, guards) — service classes + `ListingsModule` live on `listings/services` sub-barrel; `barrel-purity.spec.ts` guards the split.

**`CategoryParameter`** (`listings/domain/types/category-parameter.types.ts`): `{ id, name, type, required, multiValue?, unit?, dictionary?: {id,value,dependsOnValueIds?}[], restrictions, dependsOn?, section }`; `CategoryParameterSection = 'offer' | 'product'`. `CategoryParametersReader.fetchCategoryParameters({ categoryId }): Promise<CategoryParameter[]>`.

**`ProductVariant.attributes`**: `Record<string, string> | null` (`products/domain/entities/product-variant.entity.ts`).

---

## 5. Questions & Assumptions

### Resolved decisions
- **Scope B′ (authoritative — issue body + prior claim comment)**: `attribute_mappings` carries **both** `source_connection_id` and `destination_connection_id` as **NOT NULL**, plus a **nullable** `destination_category_id` → **two** partial unique indexes (split on `destination_category_id IS NULL` / `IS NOT NULL`). No `destination_taxonomy_provenance`, no `destination_section`, no native ids stored (provenance is derived at projection time from the adapter capability, not persisted — unlike category mappings where the resolved category's provenance is a property of the row).

### Assumptions (safe defaults)
- **`AttributeProjectionInput` carries `sourceConnectionId`** (refinement over the earlier draft, which omitted it). B′ scopes mappings by source connection, so the projection must be source-aware to pick the right mapping set — otherwise two sources mapping `"Color"` differently for the same destination collide. Input: `{ sourceConnectionId, destinationConnectionId, destinationCategoryId, attributes }`.
- **Mapping match key = `destinationParameterName` against `CategoryParameter.name`** (case-sensitive exact) in the owns path; pass-through path emits `{ id: destinationParameterName }` directly.
- **Category precedence**: a category-specific mapping (`destinationCategoryId === input.destinationCategoryId`) wins over the connection-wide default (`destinationCategoryId IS NULL`) for the same `(sourceConnectionId, sourceAttributeKey)`.
- **Dictionary value match**: exact, case-insensitive, against `dictionary[].value` → `{ id: param.id, valuesIds: [entry.id], section }`. No fuzzy matching.
- **`delete` by surrogate `id`** (no HTTP consumer yet; tests/future cockpit call it).
- **uuid PK + FK ON DELETE CASCADE** for both tables; `attribute_value_mappings.attribute_mapping_id` cascades from parent.

### Documentation gaps
- None blocking. ADR-023 §4 originally framed source-scoping as deferred; B′ (issue body) supersedes — note in the PR, no ADR change needed (B′ is *more* aligned with §4's source-scoped intent).

---

## 6. Proposed Implementation Plan

### Phase 1 — mappings storage (domain + persistence)
**Goal**: Two new mapping tables + repository + service methods, mirroring the category stack.

1. **Domain entities** — `mappings/domain/entities/attribute-mapping.entity.ts`, `attribute-value-mapping.entity.ts`
   - `AttributeMapping`: `id, sourceConnectionId, destinationConnectionId, sourceAttributeKey, destinationParameterName, destinationCategoryId: string|null, values: AttributeValueMapping[]` (pure positional-ctor class; `values` defaults `[]`).
   - `AttributeValueMapping`: `id, attributeMappingId, sourceValue, destinationValue`.
   - **Acceptance**: pure classes, no framework imports.

2. **Types** — `mappings/domain/types/mapping.types.ts` (extend)
   - `AttributeMappingInput { sourceConnectionId: string; sourceAttributeKey: string; destinationParameterName: string; destinationCategoryId?: string | null; values?: { sourceValue: string; destinationValue: string }[] }`.

3. **ORM entities** — `mappings/infrastructure/persistence/entities/attribute-mapping.orm-entity.ts`, `attribute-value-mapping.orm-entity.ts`
   - `attribute_mappings`: columns + **two partial unique indexes** on `(source_connection_id, destination_connection_id, source_attribute_key)` `WHERE destination_category_id IS NULL` and `(…, destination_category_id)` `WHERE destination_category_id IS NOT NULL`. `@OneToMany('values', { cascade: true, orphanedRowAction: 'delete', eager: true })` to value rows — so a single `repo.save(parent-with-values)` inserts/updates/removes children atomically (no hand-rolled transaction).
   - `attribute_value_mappings`: `@ManyToOne` back to parent, FK `attribute_mapping_id` (`onDelete: 'CASCADE'`), unique `(attribute_mapping_id, source_value)`.
   - **Acceptance**: index `where` clauses mirror migration verbatim (synchronize parity).

4. **Repository port** — `mappings/domain/ports/attribute-mapping-repository.port.ts`
   - `findByDestinationConnection(destinationConnectionId): Promise<AttributeMapping[]>` (joins values), `upsertMapping(destinationConnectionId, input): Promise<AttributeMapping>`, `deleteMapping(id): Promise<void>`.

5. **Repository impl** — `mappings/infrastructure/persistence/repositories/attribute-mapping.repository.ts`
   - `toDomain` (parent + mapped children), find-then-save upsert keyed on `(sourceConnectionId, destinationConnectionId, sourceAttributeKey, destinationCategoryId|IsNull())`; set the parent's `values` from `input.values` and `save` — `cascade` + `orphanedRowAction: 'delete'` replaces the child set atomically (no manual delete/transaction). Convert duplicate-key `QueryFailedError` → domain error if needed.
   - **Acceptance**: upsert create + update paths; `findByDestinationConnection` returns parents with `values` populated.

6. **Service methods** — extend `IMappingConfigService` + `MappingConfigService`
   - `getAttributeMappings(destinationConnectionId)`, `upsertAttributeMapping(destinationConnectionId, input)`, `deleteAttributeMapping(id)` → delegate to the new repo (inject `ATTRIBUTE_MAPPING_REPOSITORY_TOKEN`).

7. **Token + module + barrel**
   - `mappings.tokens.ts`: `export const ATTRIBUTE_MAPPING_REPOSITORY_TOKEN = Symbol('AttributeMappingRepositoryPort');`
   - `mappings.module.ts`: add both ORM entities to `forFeature`, provide `AttributeMappingRepository` + `useExisting` token binding.
   - `mappings/index.ts`: export `AttributeMapping`, `AttributeValueMapping`, `AttributeMappingInput`.

8. **Migration** — `apps/api/src/migrations/1805000000000-add-attribute-mappings.ts`
   - `up()`: `CREATE TABLE` both (mirror existing uuid-default + FK convention), two partial unique indexes, child unique + FK CASCADE. `down()`: drop in reverse.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it; `check:invariants` migration-ordering passes (1805 > 1804).

### Phase 2 — listings projection
**Goal**: `AttributeProjectionService` producing `ResolvedParameter[]` + diagnostics.

9. **Types** — `listings/application/types/attribute-projection.types.ts`
   - `AttributeProjectionInput { sourceConnectionId; destinationConnectionId; destinationCategoryId; attributes: Record<string,string> }`.
   - `ResolvedParameter { id: string; values?: string[]; valuesIds?: string[]; section: CategoryParameterSection }`. **`id` dual semantics** (document on the type): owns path → the live `CategoryParameter.id`; pass-through path → the `destinationParameterName` (the adapter interprets).
   - `AttributeProjectionResult { parameters: ResolvedParameter[]; unmappedSourceKeys: string[]; unresolvedRequired: { id: string; name: string }[] }`.

10. **Interface** — `listings/application/interfaces/attribute-projection.service.interface.ts`
    - `IAttributeProjectionService { project(input: AttributeProjectionInput): Promise<AttributeProjectionResult> }`.

11. **Service** — `listings/application/services/attribute-projection.service.ts`
    - Ctor: `@Inject(INTEGRATIONS_SERVICE_TOKEN) IIntegrationsService`, `@Inject(MAPPING_CONFIG_SERVICE_TOKEN) IMappingConfigService`.
    - Fetch mappings: `getAttributeMappings(destinationConnectionId)` → filter to `sourceConnectionId === input.sourceConnectionId` → collapse to one mapping per `sourceAttributeKey` with category-specific winning over category-NULL.
    - Resolve adapter; **owns** (`isCategoryParametersReader`): fetch `CategoryParameter[]`; per param, find a mapping whose `destinationParameterName` matches `param.name` **trimmed + case-insensitive** and whose source attribute is present in `attributes`; map value via value mappings (fallback to raw value when unmapped); `type==='dictionary'` → **trimmed case-insensitive** `dictionary[].value` match → `{ id, valuesIds:[entry.id], section }`, else `{ id, values:[value], section }`; `required` param unresolved → `unresolvedRequired`.
    - **not-owns** (no reader → borrows/open): pass-through — per mapped+present attribute emit `{ id: destinationParameterName, values:[mappedValue], section:'offer' }`.
    - Source attribute present but unmapped → `unmappedSourceKeys` (+ `debug` log).

12. **Token + module + barrel**
    - `listings.tokens.ts`: `export const ATTRIBUTE_PROJECTION_SERVICE_TOKEN = Symbol('IAttributeProjectionService');`
    - `listings.module.ts`: provide `AttributeProjectionService` + `useExisting` token binding; export token.
    - `listings/services/index.ts`: export `AttributeProjectionService` class. `listings/index.ts`: export `IAttributeProjectionService` + the new types (contracts only — keep service class off the main barrel).

### Phase 3 — tests
13. **Unit** — `attribute-projection.service.spec.ts` (owns dictionary→valuesIds, owns free-text→values, required-unmapped→unresolvedRequired, not-owns pass-through, unmapped→unmappedSourceKeys, category-specific-over-default precedence, source-connection filtering); `attribute-mapping.repository.spec.ts` if pure-logic warrants (else covered by int-spec).
14. **Int-spec** — `apps/api/test/integration/mappings/attribute-mappings.int-spec.ts`: partial unique indexes (NULL-distinct: same key with NULL vs a category id coexist; duplicate within same partial rejected), value-mapping cascade delete, `MappingConfigService` round-trip via real Postgres.

---

## 7. Alternatives Considered

- **Scope A (drop `source_connection_id`)** — one nullable column, two indexes, lighter. **Rejected**: superseded by the issue body's B′; #1050 making source keys semantic doesn't remove the need to disambiguate *which* source's `"Color"` a mapping is for when multiple sources feed one destination. B′ is the correct source-scoped default and still only two indexes (category nullable, not source).
- **Store provenance/section on the mapping row** (mirror category). **Rejected**: attribute provenance is a runtime property of the destination adapter capability (owns/borrows/open), not of the mapping; `section` comes from the live `CategoryParameter`. Persisting them would duplicate runtime truth and risk drift.
- **`repo.upsert` (ON CONFLICT)** instead of find-then-save. **Rejected**: Postgres `ON CONFLICT` can't target a *partial* unique index cleanly with the nullable category column — same reason #1036 used find-then-save.

---

## 8. Validation & Risks

- **Architecture**: ✅ domain pure; projection depends on `IMappingConfigService` + `IIntegrationsService` interfaces; storage in `mappings`; cross-context via top-level barrels; service implements an interface (`check-service-interfaces`).
- **Naming**: ✅ `*.entity.ts` / `*.orm-entity.ts` / `*.repository.ts` / `*.service.ts` + `I*Service`; `ATTRIBUTE_*_TOKEN` Symbols.
- **Risks**:
  - *synchronize↔migration drift* — declare the partial indexes on the ORM entity (integration harness uses `synchronize`). Mitigated by mirroring the #1036 pattern + the int-spec asserting NULL-distinct.
  - *barrel purity* — keep `AttributeProjectionService` off `listings/index.ts` (only on `/services`); `barrel-purity.spec.ts` guards.
  - *migration ordering* — fixed `1805000000000`; re-prefix if `migration:generate` is used.
  - *cross-context cycle* — `listings → mappings` already exists; no new cycle.
- **Edge cases**: empty `attributes`; mapping with no value mappings (pass source value through); dictionary value not found (required→`unresolvedRequired`, optional→omit); multi-value params (v1 emits single value; `multiValue` honoured later — note, not blocking).
- **Backward compatibility**: ✅ additive — new tables, new methods, new service; no existing contract changes.

---

## 9. Testing Strategy & Acceptance Criteria

- **Unit**: `libs/core/src/listings/application/services/__tests__/attribute-projection.service.spec.ts` (mock `IIntegrationsService` + `IMappingConfigService`); repository pure-logic if any.
- **Integration**: `apps/api/test/integration/mappings/attribute-mappings.int-spec.ts` (Testcontainers Postgres).
- **Mocking**: mock ports/interfaces in unit; real DB in int-spec (never mocked).
- **Acceptance**:
  - [ ] Allegro-style dictionary parameter → `{ id, valuesIds }`; free-text → `{ id, values }`.
  - [ ] Unmapped optional source key → `unmappedSourceKeys`; required unresolved → `unresolvedRequired`.
  - [ ] not-owns destination → pass-through `{ id: destinationParameterName, values, section:'offer' }`.
  - [ ] Two partial unique indexes enforce NULL-distinct; value-mapping FK cascades.
  - [ ] Migration up/down verified; `pnpm lint` (incl. invariants), `pnpm type-check`, `pnpm test`, int-spec green.

---

## 10. Alignment Checklist
- [x] Hexagonal architecture; CORE/Integration boundary respected
- [x] Reuses existing patterns (category stack, CategoryResolutionService)
- [x] Idempotency (find-then-save upsert; projection is pure/read-only)
- [x] Error handling (domain errors from repo; capability guard for owns/not-owns)
- [x] Testing strategy complete (unit + int-spec)
- [x] Naming + file structure per standards
- [x] Migration ordering (1805 > 1804)
- [x] Execution-ready

---

## Related Documentation
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md) · [Migrations](../migrations.md)
- ADR-023 (cross-platform category & attribute projection) §3/§4/§Storage
