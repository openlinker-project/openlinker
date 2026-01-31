# Implementation Plan: Persist Variant EAN/GTIN for Offer Linking (Issue 48)

**Date**: 2026-01-31  
**Status**: Draft  
**Estimated Effort**: 2-3 days

---

## 1. Task Summary

**Objective**: Persist EAN/GTIN on `product_variants`, normalize barcode inputs, and update offer linking + PrestaShop mapping so Allegro offer linking by barcode is reliable and unique.

**Context**: `OfferMappingSyncService` currently looks up barcode values in `product_variants.attributes`, which are not populated by adapters. Canonical columns and deterministic variant handling are needed to link offers to variants.

**Classification**: CORE / Integration / Infrastructure / Testing / Documentation

---

## 2. Scope & Non-Goals

### In Scope
- Add `ean`/`gtin` fields to `ProductVariant` domain/port/ORM and persist to DB.
- Barcode normalization/validation helper reused by core services + integrations.
- Repository lookup by barcode (columns-first, attributes fallback) with ambiguity detection.
- Offer mapping: link only on unique barcode match; log skipped reasons.
- PrestaShop adapter: map `ean13`/`upc`, and synthesize deterministic variant for simple products.
- Backfill existing `attributes->>ean/gtin` into columns.
- Unit tests + mapper/adapter tests + offer mapping tests.
- Documentation updates for barcode storage and linking behavior.

### Out of Scope
- Adding EAN/GTIN to `products`.
- Supporting multiple barcodes per variant.
- API/UI changes.
- Non-PrestaShop adapters (future follow-up).

### Constraints
- Must respect hexagonal architecture boundaries.
- Maintain backward compatibility: attributes fallback is temporary.
- Keep linking deterministic and safe; do not link on ambiguous matches.

---

## 3. Architecture Mapping

**Target Layer**: CORE (products/listings), Integration (PrestaShop), Infrastructure (DB/migrations)

**Capabilities Involved**:
- `ProductMasterPort` (adapter data shape)
- `ProductVariantRepositoryPort` (barcode lookup)
- `MarketplacePort` offer feed (EAN/GTIN inputs)

**Existing Services Reused**:
- `MasterProductSyncService`
- `ProductsService`
- `OfferMappingSyncService` + `OfferLinkingService`
- `PrestashopProductMapper`
- `ProductVariantRepository`

**New Components Required**:
- Barcode normalization helper (core/shared module exported for adapters).
- `ean`/`gtin` columns on `ProductVariantOrmEntity`.
- Repository lookup result shape or companion method for ambiguity detection.
- Synthetic-variant reconciliation step when combinations appear.
- Migration with backfill and indexes.

**Core vs Integration Justification**:
- Barcode persistence and lookup are canonical product-domain concerns (CORE).
- Mapping PrestaShop fields into canonical variants is integration-specific (Integration).

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System (if applicable)
- **Authentication**: Existing PrestaShop WebService auth (no change).
- **Rate Limits**: No new external calls; reuse current product/combination fetches.
- **API Documentation**: PrestaShop fields `ean13` and `upc` on product/combination.
- **Marketplace Rules**: Allegro GTIN accepts lengths 8/10/12/13/14; `ean` field is read-only and GTIN parameter is authoritative.
- **Data Models**: `PrestashopProduct` and `PrestashopCombination` in `prestashop.mapper.interface.ts`.
- **Error Handling**: No new external errors beyond existing adapter handling.
- **Known Pitfalls**: `ean13`/`upc` can be empty; must normalize/validate.

### Internal Patterns
- **Similar Implementations**:
  - Offer linking and lookup flow: `OfferMappingSyncService` and `OfferLinkingService`.
  - Repository unit testing pattern: `OrderRecordRepository` tests use mocked TypeORM repo.
  - PrestaShop product mapping: `PrestashopProductMapper` + tests.
- **Reusable Components**:
  - `OfferLinkingService` to enforce deterministic linking.
  - `MasterProductSyncService` + `ProductsService` for upserts.
- **Existing Patterns**:
  - Attributes JSONB used as transitional fallback.
  - Ports and adapters in separate layers with tokens.

---

## 5. Questions & Assumptions

### Open Questions
- Where is the canonical master catalog connection resolved (source-of-truth) for `marketplace.offers.sync` in current routing logic?
- What is the existing reconciliation strategy for removing stale variants when combinations appear? (No delete flow found in `ProductsService`.)

### Assumptions
- Barcode lookup must be scoped to the master catalog connection, not the marketplace connection.
- Internal product/variant IDs are shared across connections, so scoping is enforced via `identifier_mappings` join rather than `product_variants.connectionId`.
- `ean13` and `upc` are present in PrestaShop API payloads (nullable).
- Barcode normalization accepts lengths 8/10/12/13/14 and preserves leading zeros.

### Documentation Gaps
- No documented guidance for variant reconciliation/deletion in master sync pipeline.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain + Persistence Modeling
**Goal**: Add canonical barcode fields and normalization helper.

**Steps**:
1. **Define barcode normalization helper**
   - **File**: `libs/core/src/products/domain/utils/barcode-normalization.ts` (export via `libs/core/src/products/index.ts`)
   - **Action**: Implement `normalizeBarcode(input)` (trim, remove non-digits, preserve leading zeros, accept lengths 8/10/12/13/14; return `null` otherwise).
   - **Acceptance**: Unit tests cover trim, non-digit stripping, leading zeros, valid lengths 8/10/12/13/14, invalid lengths.
   - **Dependencies**: None.

2. **Extend domain + port types**
   - **File**: `libs/core/src/products/domain/entities/product-variant.entity.ts`
   - **Action**: Add `ean?: string | null`, `gtin?: string | null` to constructor + fields.
   - **Acceptance**: Domain entity supports barcode values without breaking existing callers.
   - **Dependencies**: Step 1.

3. **Update port DTOs**
   - **File**: `libs/core/src/products/domain/types/product.types.ts`
   - **Action**: Add `ean?: string`, `gtin?: string` to `ProductVariantCreate`.
   - **Acceptance**: Port types compile and are compatible with adapters.
   - **Dependencies**: Step 2.

4. **Update ORM entity + mapping**
   - **File**: `libs/core/src/products/infrastructure/persistence/entities/product-variant.orm-entity.ts`
   - **Action**: Add nullable `ean` and `gtin` columns (varchar) with indexes.
   - **Acceptance**: ORM entity matches migration schema.
   - **Dependencies**: Step 2.

### Phase 2: Persistence Lookup + Backfill
**Goal**: Query by canonical columns and backfill existing data.

**Steps**:
1. **Update repository lookup contract**
   - **File**: `libs/core/src/products/domain/ports/product-variant-repository.port.ts`
   - **Action**: Replace or extend `findByEanOrGtinIn` to return a structure that distinguishes `resolved` vs `ambiguous`.
   - **Acceptance**: Callers can detect ambiguity without guessing.
   - **Dependencies**: Phase 1.

2. **Implement columns-first lookup with fallback**
   - **File**: `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts`
   - **Action**: Query `ean`/`gtin` columns first, scoped to the master catalog connection via `identifier_mappings` join; fallback to attributes-based lookup for legacy data.
   - **Action**: Scope uses `identifier_mappings` where `entityType = 'Product'` and `context.metadata.isVariant = true` (per PrestaShop adapter mapping).
   - **Acceptance**: Uses normalization helper and marks ambiguous barcodes as such; lookup excludes variants not mapped to the master connection.
   - **Dependencies**: Phase 1, Step 1.

3. **Migration + backfill**
   - **File**: `apps/api/src/migrations/<timestamp>-add-variant-barcodes.ts`
   - **Action**: Add `ean`/`gtin` columns, add indexes, and backfill from `attributes->>'ean'/'gtin'` using SQL normalization (`regexp_replace(value, '\D', '', 'g')`).
   - **Action**: Backfill writes `attributes.ean` → `ean` and `attributes.gtin` → `gtin` only (no cross-assignment).
   - **Action**: Ensure `identifier_mappings` index supports scoping join:
     - Existing index `IDX_identifier_mappings_connection_internal` on (`entityType`, `connectionId`, `internalId`) exists (migration `1773000000000-add-identifier-mappings-connection-internal-index.ts`); add `connectionId, entityType, internalId` index only if query plan requires it.
   - **Action**: Add partial indexes on `product_variants`:
     - `CREATE INDEX ... ON product_variants (ean) WHERE ean IS NOT NULL`
     - `CREATE INDEX ... ON product_variants (gtin) WHERE gtin IS NOT NULL`
   - **Acceptance**: Schema changes reversible; backfill is idempotent (only fills NULL) and skips invalid values.
   - **Dependencies**: Phase 1, Step 4.

### Phase 3: Core Sync + Linking Behavior
**Goal**: Normalize barcodes in sync and enforce unique-match linking.

**Steps**:
0. **Ensure master-connection scoping**
   - **File**: `libs/core/src/listings/application/services/offer-mapping-sync.service.ts`
   - **Action**: Resolve `masterConnectionId` explicitly and pass it to barcode lookup (e.g., `findByEanOrGtinIn(masterConnectionId, codes)`).
   - **Action**: Proposed source of truth: add `masterConnectionId` to `MarketplaceOffersSyncPayloadV1` in `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` and populate it in `apps/api/src/sync/application/services/scheduler.service.ts` (from marketplace connection config, e.g., `config.masterCatalogConnectionId`).
   - **Action**: Update `apps/worker/src/sync/handlers/marketplace-offers-sync.handler.ts` to pass the payload `masterConnectionId` through to the core service.
   - **Acceptance**: Barcode lookup is explicitly scoped to the master catalog connection, not the marketplace connection; if missing, skip barcode linking with warning.
   - **Dependencies**: Phase 2, Step 1.

1. **Normalize barcode inputs for offer lookup**
   - **File**: `libs/core/src/listings/application/services/offer-mapping-sync.service.ts`
   - **Action**: Normalize incoming offer `ean/gtin` before querying; use new repository lookup results to skip ambiguous matches.
   - **Acceptance**: `OfferLinkingService` links only when barcode match is unique; log reasons for ambiguity/missing.
   - **Dependencies**: Phase 3, Step 0.

2. **Update linking lookups to use columns**
   - **File**: `libs/core/src/listings/application/services/offer-mapping-sync.service.ts`
   - **Action**: Build lookup maps from canonical `ean`/`gtin` fields (fallback to attributes when needed).
   - **Acceptance**: Barcode linking works with persisted columns and retains backward compatibility.
   - **Dependencies**: Phase 2, Step 2.

### Phase 4: PrestaShop Adapter Updates
**Goal**: Populate barcode fields and synthesize deterministic variants for simple products.

**Steps**:
1. **Extend PrestaShop DTOs**
   - **File**: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop.mapper.interface.ts`
   - **Action**: Add `ean13?: string`, `upc?: string` to `PrestashopProduct` and `PrestashopCombination`.
   - **Acceptance**: Mapper tests compile and can pass barcode fields.
   - **Dependencies**: Phase 1.

2. **Map barcode fields in mapper**
   - **File**: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts`
   - **Action**: Normalize `ean13` → `variant.ean` and `upc` → `variant.gtin` with combination-first precedence and stricter fallback rules:
     - If `combinations.length > 1`, do not fall back to product-level barcode.
     - If `combinations.length === 1`, allow product-level fallback if combination barcode is missing.
   - **Action**: Assignment rule for Allegro compatibility: length 13 → `ean`, all other valid lengths → `gtin`.
   - **Acceptance**: Mapper tests cover precedence and fallback rules for multi-combination vs single-combination products.
   - **Dependencies**: Phase 1, Step 1.

3. **Synthetic variant for simple products**
   - **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts`
   - **Action**: When combinations are empty, return one synthetic variant with stable `externalId` (`product:<prestashopId>`), SKU fallback, and normalized barcode fields.
   - **Acceptance**: Adapter returns exactly one variant for simple products, and barcode fields are populated.
   - **Dependencies**: Phase 4, Step 2.

4. **Reconcile synthetic variant when combinations appear**
   - **File**: `libs/core/src/products/application/services/master-product-sync.service.ts` (or a new reconciliation helper)
   - **Action**: Minimal reconciliation for MVP:
     - If `combinations.length > 0`, delete the `identifier_mappings` row for synthetic externalId `product:<prestashopProductId>` (entityType `Product`, `context.metadata.isVariant = true`) on the master connection.
     - Do not delete `product_variants` rows; only remove the mapping that scopes it into the catalog.
   - **Acceptance**: No ambiguous barcode matches due to stale synthetic variants; synthetic variant no longer scoped into master catalog.
   - **Dependencies**: Phase 4, Step 3.

### Phase 5: Tests + Documentation
**Goal**: Validate behavior and update docs.

**Steps**:
1. **Add unit tests**
   - **Files**:
     - `libs/core/src/products/domain/utils/__tests__/barcode-normalization.spec.ts`
     - `libs/core/src/products/infrastructure/persistence/repositories/__tests__/product-variant.repository.spec.ts`
     - `libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts`
     - `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts`
     - `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-product-master.adapter.spec.ts`
   - **Action**: Cover normalization, repository lookup ambiguity, barcode mapping precedence, synthetic variant behavior, and unique-match-only linking.
   - **Acceptance**: Tests pass, and ambiguous/missing barcode logic is validated.
   - **Dependencies**: Phases 1-4.

2. **Update documentation**
   - **File**: `docs/architecture-overview.md` or `docs/implementation-plan-issue-47-offer-mapping-sync.md`
   - **Action**: Document variant-level barcode storage, synthetic variants, and unique-match-only linking.
   - **Acceptance**: Docs reflect new canonical behavior.
   - **Dependencies**: Phase 3-4.

### Implementation Details

**New Components**:
- **Domain**: `normalizeBarcode` helper, `ProductVariant` fields `ean`/`gtin`.
- **Application**: Updates to `MasterProductSyncService` to pass barcodes and reconcile synthetic variants.
- **Infrastructure**: `ProductVariantOrmEntity` columns, repository lookup changes, migration + backfill.
- **Interface**: N/A (no new controllers/handlers).

**Configuration Changes**:
- Add `masterCatalogConnectionId` (or similar) to marketplace connection config so scheduler can populate `MarketplaceOffersSyncPayloadV1.masterConnectionId`.

**Database Migrations**:
- Add columns `ean`/`gtin` to `product_variants`, add indexes, backfill from `attributes` JSON using digit-only normalization.

**Events**:
- None.

**Error Handling**:
- Use existing conflict handling in `OfferMappingSyncService`; add structured skip reasons for ambiguous/missing/invalid barcodes.

**Reference**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Keep barcode data in `attributes` JSON only
- **Description**: Continue to store and query EAN/GTIN in `attributes`.
- **Why Rejected**: Poor performance, no indexable fields, inconsistent adapter population.
- **Trade-offs**: Less schema change, but unreliable linking.

### Alternative 2: Store barcodes on `products`
- **Description**: Add `ean/gtin` to product-level table and map offers to products.
- **Why Rejected**: Violates invariant: offer linking targets variants, not products.
- **Trade-offs**: Simpler schema, incorrect linking semantics.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Core persistence changes stay in `libs/core/src/products`.
- ✅ Integration mapping stays in PrestaShop adapter.
- **Reference**: [Architecture Overview](./architecture-overview.md)

### Naming Conventions
- ✅ New files follow `*.ts` patterns and module structure.
- **Reference**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Repository unit tests follow mock-repo pattern used in `OrderRecordRepository`.
- ✅ Offer mapping uses existing `OfferLinkingService` behavior.

### Risks
- **Ambiguous barcodes**: Multiple variants share barcodes; mitigation is strict unique-match-only linking + logging + master-connection scoping.
- **Data migration**: Backfill may miss malformed values; mitigation is normalization + idempotent migration.
- **Synthetic variant cleanup**: If deletion is not supported, ambiguity may persist; mitigation is explicit reconciliation step.

### Edge Cases
- **Leading zeros**: Must remain intact; normalization preserves them.
- **Invalid lengths**: Store `null` and skip linking.
- **Combinations added later**: Must remove synthetic variant to avoid ambiguity.

### Backward Compatibility
- ✅ Attributes fallback retained for legacy data.
- ✅ Scoping enforced via master-connection mappings (no schema change required).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `normalizeBarcode` behavior for trimming, digit-only, and length validation (8/10/12/13/14).
- Repository lookup (columns-first, fallback, ambiguity detection).
- `OfferMappingSyncService` skip reasons for ambiguous/missing/invalid barcode.
- PrestaShop mapper: `ean13`/`upc` mapping + precedence.
- PrestaShop adapter: synthetic variant returned for simple products.

**Files**:
- `libs/core/src/products/domain/utils/__tests__/barcode-normalization.spec.ts`
- `libs/core/src/products/infrastructure/persistence/repositories/__tests__/product-variant.repository.spec.ts`
- `libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts`
- `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts`
- `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-product-master.adapter.spec.ts`

### Integration Tests
- Optional: add a targeted integration test to verify migration + lookup if repository tests are insufficient.

### Mocking Strategy
- Mock TypeORM repositories for unit tests (per `OrderRecordRepository` tests).
- Mock PrestaShop HTTP client and identifier mapping in adapter tests.

### Acceptance Criteria
- [ ] `product_variants` has nullable `ean` and `gtin` columns with indexes.
- [ ] Barcodes are normalized and validated on write; invalid values stored as `null` (lengths 8/10/12/13/14 only).
- [ ] Backfill migration populates columns from attributes where valid.
- [ ] Barcode lookup uses columns-first, detects ambiguity, and is scoped to master catalog connection; attributes fallback retained.
- [ ] Offer mapping links only when barcode match is unique; ambiguous/missing logged.
- [ ] PrestaShop sync populates barcode fields for combinations and simple products with strict fallback rules for multi-combination products.
- [ ] Simple products yield exactly one deterministic synthetic variant.
- [ ] Synthetic variant mapping is deleted when combinations appear (no longer scoped into master catalog).
- [ ] Tests pass.

**Reference**: [Testing Guide](./testing-guide.md)

---

## 10. Alignment Checklist

- [ ] Follows hexagonal architecture
- [ ] Respects CORE vs Integration boundaries
- [ ] Uses existing patterns (no unnecessary abstractions)
- [ ] Idempotency considered
- [ ] Event-driven patterns used where applicable
- [ ] Rate limits & retries addressed
- [ ] Error handling comprehensive
- [ ] Testing strategy complete
- [ ] Naming conventions followed
- [ ] File structure matches standards
- [ ] Plan is execution-ready
- [ ] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- [Code Review Guide](./code-review-guide.md)
