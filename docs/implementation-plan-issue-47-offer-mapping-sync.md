# Implementation Plan: Marketplace Offer Mapping Sync (ISSUE_47)

**Date**: 2026-01-25  
**Status**: Draft  
**Estimated Effort**: 3-5 days

---

## 1. Task Summary

**Objective**: Add a production-safe pipeline to populate `identifier_mappings` for `entityType='Offer'` before order sync runs, using a new `marketplace.offers.sync` job and deterministic linking rules.  

**Context**: `marketplace.order.sync` fails in production because `OrderItemRefResolver` requires an Offer mapping that is never created outside tests.  

**Classification**: CORE + Integration + Infrastructure + Worker + Database + Documentation

---

## 2. Scope & Non-Goals

### In Scope
- Add Offer list types and optional `MarketplacePort.listOffers` capability in core.
- Implement deterministic Offer linking and mapping upsert in core application layer.
- Add `marketplace.offers.sync` worker job and handler.
- Add Allegro adapter implementation of `listOffers` (minimal fields).
- Add DB indexes/constraints for safe and fast Offer mapping upserts.
- Add unit tests for linking/sync services and handler.
- Add a short note to architecture docs about Offer mapping population via sync job.

### Out of Scope
- Any ops/admin endpoints or UI for manual mapping/requeue.
- Changing order sync behavior to create Offer mappings inline.
- Broad refactors of product/inventory schemas unrelated to linking.

### Constraints
- Must keep order sync deterministic; no mapping creation in hot path.
- Maintain CORE vs Integration boundaries.
- Ensure idempotency and safe re-runs of offer mapping sync.
- Avoid breaking existing identifier mapping uniqueness rules.
- Offer mappings must always target internal sellable item (variant) IDs.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/`), Integration (`libs/integrations/allegro`), Worker (`apps/worker`), Database (`apps/api/src/migrations`), Docs (`docs/`)

**Capabilities Involved**:
- `MarketplacePort` (extend with optional `listOffers`)
- `IdentifierMappingService` (for upsert)
- Product/Variant repositories (for deterministic matching)

**Existing Services Reused**:
- `IntegrationsService` for adapter resolution
- `IdentifierMappingService` for mapping upsert and conflict detection
- Worker sync job infrastructure (registry, runner, enqueue)

**New Components Required**:
- `MarketplaceOfferFeedInput/Item/Output` types
- `OfferLinkingService` (core application)
- `OfferMappingSyncService` (core application)
- `marketplace.offers.sync` job type + payload type
- `MarketplaceOffersSyncHandler` (worker)

**Core vs Integration Justification**:
- Deterministic linking and mapping creation is core orchestration logic; adapters only provide data via `MarketplacePort.listOffers`.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System (if applicable)
- **Authentication**: Allegro OAuth (existing adapter config).
- **Rate Limits**: Determine from Allegro docs for offer listing.
- **API Documentation**: Allegro `GET /sale/offers` (limit/offset pagination).
- **Data Models**: Offer ID plus `external.id` (externalRef); SKU/EAN best-effort.
- **Error Handling**: Reuse existing Allegro HTTP client error handling patterns.
- **Known Pitfalls**: Offset pagination and partial field availability for EAN/GTIN.

### Internal Patterns
- **Similar Implementations**:
  - `InventorySyncService` for adapter capability usage.
  - `MarketplaceOrderSyncHandler` and `MarketplaceOfferQuantityUpdateHandler` for worker handler patterns.
  - `IdentifierMappingService.getOrCreateExactMapping` for idempotent upsert behavior.
- **Reusable Components**:
  - `IntegrationsService.getCapabilityAdapter`.
  - `SyncJobHandler` + registry.
- **Existing Patterns**:
  - `MarketplaceOrderFeedInput/Output` for pagination design.
  - `IdentifierMappingRepository.insertMapping` for safe inserts.

---

## 5. Questions & Assumptions

### Open Questions
- What Allegro fields beyond `external.id` are cheap enough for MVP (`sku`, `ean/gtin`)?
- Where should EAN/GTIN live in core data model (product/variant attributes vs dedicated field)?

### Assumptions
- Keep the existing unique constraint shape `(entityType, platformType, connectionId, externalId)` to align with current ORM and migrations.
- `identifier_mappings('Offer').internalId` always points to the internal sellable item ID (prefer `ProductVariant`), never a product ID.
- Deterministic matching uses `external.id` first, then SKU, then EAN/GTIN (variant-only).
- Core `cursor` is opaque; Allegro adapter encodes/decodes offset as cursor.
- Allegro `external.id` is treated as an external signature for linking; if we cannot map it to an internal variant deterministically, we skip.

### Documentation Gaps
- No explicit doc on Offer linking rules or Offer mapping population path.
- `Listings` module referenced in docs but not present in codebase (confirm target module location).

---

## 6. Proposed Implementation Plan

### Phase 1: Database Hardening
**Goal**: Ensure Offer mapping upsert is safe and efficient.

**Steps**:
1. **Update ORM indexes (source of truth)**
   - **File**: `libs/core/src/identifier-mapping/infrastructure/persistence/entities/identifier-mapping.orm-entity.ts`
   - **Action**: Ensure unique index on `(entityType, platformType, connectionId, externalId)` and non-unique reverse index on `(entityType, connectionId, internalId)`. Remove any uniqueness on internalId.
   - **Acceptance**: ORM entity reflects desired constraints and indexes.

2. **Generate/verify migration**
   - **File**: `apps/api/src/migrations/<new>--identifier-mappings-offer-constraints.ts`
   - **Action**: Generate or hand-verify migration to match ORM indexes; ensure no uniqueness on internalId.
   - **Acceptance**: Migration runs cleanly; DB has expected unique constraint.
   - **Dependencies**: Confirm existing indexes from `1766246163229` and `1772000000000` to avoid conflicts.

3. **Add reverse lookup index**
   - **File**: same migration
   - **Action**: Add non-unique INDEX on `(entityType, connectionId, internalId)`; keep or align existing reverse indexes as needed.
   - **Acceptance**: Query planner uses index for reverse lookup.

### Phase 2: Core Types & Port Extension
**Goal**: Add offer feed types and `listOffers` capability.

**Steps**:
1. **Define offer feed types**
   - **File**: `libs/core/src/integrations/domain/types/marketplace-offer-feed.types.ts`
   - **Action**: Add `MarketplaceOfferFeedInput`, `MarketplaceOfferFeedItem`, `MarketplaceOfferFeedOutput`.
   - **Acceptance**: Types exported from `libs/core/src/integrations/index.ts`.

2. **Extend MarketplacePort**
   - **File**: `libs/core/src/integrations/domain/ports/marketplace.port.ts`
   - **Action**: Add optional `listOffers(input): Promise<MarketplaceOfferFeedOutput>`.
   - **Acceptance**: Type compiles; adapters unaffected unless implementing.

### Phase 3: Core Offer Linking & Mapping Sync
**Goal**: Implement deterministic linking and mapping upsert in core.

**Steps**:
1. **Create OfferLinkingService**
   - **File**: `libs/core/src/listings/application/services/offer-linking.service.ts`
   - **Action**: Given offer feed item, resolve internal *variant* target only when unique match exists (`externalRef`/`external.id`, SKU, EAN/GTIN).
   - **Acceptance**: Returns link result or skip reason; ambiguous matches skipped.
   - **Dependencies**: Add repository methods to query variants by SKU (and EAN if supported).

   **Deterministic rules (variant-first)**:
   - If `externalRef` exists and maps **uniquely** to a variant → link.
   - Else if `sku` exists and maps **uniquely** to a variant → link.
   - Else if `ean/gtin` exists and maps **uniquely** to a variant → link.
   - Else skip (record skip reason).

2. **Add repository query helpers**
   - **File**: `libs/core/src/products/domain/ports/product-variant-repository.port.ts`
   - **Action**: Add `findBySku(sku)` and `findBySkuIn(skus)`; implement in `product-variant.repository.ts`.
   - **Acceptance**: Unit tests can locate unique matches by SKU and batch lookups.
   - **Note**: Add `findByExternalRefIn` only if `externalRef` maps to internal identifiers in canonical storage.

3. **Create OfferMappingSyncService**
   - **File**: `libs/core/src/listings/application/services/offer-mapping-sync.service.ts`
   - **Action**:
     - Resolve `MarketplacePort` via `IntegrationsService`.
     - Page through `listOffers({ cursor, limit })` using opaque cursor.
     - Batch-prepare lookup maps (externalRef/SKU/EAN) per page to avoid per-offer DB queries.
     - Call `OfferLinkingService` for each item (variant-only).
     - Upsert mapping via `IdentifierMappingService.getOrCreateExactMapping('Offer', offerId, internalId, connectionId, context)`.
     - Return stats `{ scanned, linked, skipped, nextCursor }`.
   - **Acceptance**: Idempotent across repeated runs; conflict exceptions logged and skipped.

4. **Module wiring and exports**
   - **File**: `libs/core/src/listings/listings.module.ts`, `libs/core/src/listings/index.ts`
   - **Action**: Add module, tokens, interfaces if needed; export services.
   - **Acceptance**: Worker can inject `OfferMappingSyncService` via token.

### Phase 4: Worker Job + Handler
**Goal**: Add `marketplace.offers.sync` job to trigger mapping population.

**Steps**:
1. **Add job type and payload**
   - **File**: `libs/core/src/sync/domain/types/sync-job.types.ts`
   - **Action**: Add `marketplace.offers.sync` to `JobTypeValues`.
   - **File**: `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`
   - **Action**: Add `MarketplaceOffersSyncPayloadV1` with `limit`, `cursor?`.
   - **Acceptance**: API DTO validation picks up new job type.

2. **Create handler**
   - **File**: `apps/worker/src/sync/handlers/marketplace-offers-sync.handler.ts`
   - **Action**: Validate payload and call `OfferMappingSyncService.sync(connectionId, { limit, cursor })`.
   - **Follow-up**: If `nextCursor` exists, enqueue a follow-up `marketplace.offers.sync` job (preferred) or loop within handler to completion with a bounded time budget.
   - **Acceptance**: Handler delegates and surfaces errors via `SyncJobExecutionError`.

3. **Register handler**
   - **File**: `apps/worker/src/sync/handlers/handler-registration.service.ts`
   - **Action**: Register `'marketplace.offers.sync'`.
   - **Acceptance**: Registry returns handler for job type.

### Phase 5: Allegro Adapter Implementation
**Goal**: Implement `MarketplacePort.listOffers`.

**Steps**:
1. **Add Allegro offer listing**
   - **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`
   - **Action**: Call Allegro `GET /sale/offers?limit=&offset=` and map to `MarketplaceOfferFeedOutput` using cursor-as-offset (opaque string).
   - **Acceptance**: Returns `offerId` and best-effort keys, with `externalRef = offer.external.id` prioritized.
   - **Dependencies**: Confirm response shape and offset pagination semantics.

### Phase 6: Tests
**Goal**: Ensure deterministic linking and job flow correctness.

**Steps**:
1. **OfferLinkingService unit tests**
   - **File**: `libs/core/src/listings/application/services/__tests__/offer-linking.service.spec.ts`
   - **Action**: Verify unique match only; ambiguous or missing match skips.

2. **OfferMappingSyncService unit tests**
   - **File**: `libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts`
   - **Action**: Verify idempotent upsert and correct mapping fields/context.

3. **Worker handler unit test**
   - **File**: `apps/worker/src/sync/handlers/__tests__/marketplace-offers-sync.handler.spec.ts`
   - **Action**: Validate payload parsing and service delegation.

### Phase 7: Documentation
**Goal**: Add minimal note in architecture docs.

**Steps**:
1. **Document Offer mapping flow**
   - **File**: `docs/architecture-overview.md`
   - **Action**: Add a short note stating Offer mappings are populated by `marketplace.offers.sync`.

---

### Implementation Details

**New Components**:
- **Domain**: Offer feed types under integrations domain.
- **Application**: `OfferLinkingService`, `OfferMappingSyncService`.
- **Infrastructure**: DB migration for indexes/constraints.
- **Interface**: Worker handler.

**Configuration Changes**:
- None expected (unless adding optional default limit).

**Database Migrations**:
- New migration to align unique and reverse lookup indexes on `identifier_mappings`.

**Events**:
- None (job-based flow).

**Error Handling**:
- Use `IdentifierMappingConflictException` to skip conflicting mappings.
- Fail job with `SyncJobExecutionError` only on service-level failures.

**Reference**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Create mappings during `marketplace.order.sync`
- **Description**: If Offer mapping missing, create it inside order ingestion.
- **Why Rejected**: Violates requirement to keep order sync deterministic and non-augmenting.
- **Trade-offs**: Simpler flow but adds side effects and hidden coupling.

### Alternative 2: Store offer mappings in a dedicated table
- **Description**: Introduce `offer_mappings` table with separate indexes.
- **Why Rejected**: Architecture already consolidates mappings in `identifier_mappings`.
- **Trade-offs**: More schema complexity and duplicated logic.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Uses core application service for orchestration and adapter capability for data retrieval.
- **Reference**: [Architecture Overview](./architecture-overview.md)

### Naming Conventions
- ✅ Follows existing `Marketplace*` type patterns and `*SyncService` naming.
- **Reference**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Mirrors `marketplace.order.sync` and `marketplace.offerQuantity.update` handler patterns.

### Risks
- **SKU/EAN availability**: Low match rate if Allegro fields are missing; mitigate by best-effort and skip.
- **Internal ID mismatch**: Ensure order flow consumes sellable/variant IDs consistently to avoid mapping to product IDs.
- **Offset cursor conversion**: Adapter cursor encoding/decoding errors can cause gaps or reprocessing; guard with explicit tests.
- **Index mismatch**: Existing migrations may conflict; ensure migration is additive and idempotent.

### Edge Cases
- **Ambiguous matches**: Multiple variants with same SKU/EAN; skip linking.
- **Conflicting mappings**: Offer already mapped to different internalId; log and skip.
- **Pagination gaps**: Offset-based pagination with concurrent catalog changes; handle empty pages and stop conditions gracefully.

### Backward Compatibility
- ✅ No breaking changes to existing job types or handlers.
- ✅ `listOffers` is optional on port; other adapters unaffected.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `OfferLinkingService` deterministic matching (unique vs ambiguous).
- `OfferMappingSyncService` idempotent mapping and stats.

### Integration Tests
- Optional: worker job intake → handler → core service flow using mocks.

### Mocking Strategy
- Mock `MarketplacePort.listOffers` and repositories for core tests.
- Mock `OfferMappingSyncService` in handler tests.

### Acceptance Criteria
- [ ] `identifier_mappings` has UNIQUE `(entityType, platformType, connectionId, externalId)` and INDEX `(entityType, connectionId, internalId)`.
- [ ] ORM entity indexes match DB constraints (no uniqueness on `(entityType, internalId)`).
- [ ] `marketplace.offers.sync` job type exists and handler is registered.
- [ ] Running the job creates Offer mappings with correct fields and context.
- [ ] Offer linking is deterministic and skips ambiguous matches.
- [ ] Offer mapping `internalId` always points to the internal sellable item (variant) ID.
- [ ] `marketplace.order.sync` no longer throws for offers that were linked by the job.
- [ ] Handler continues until completion via follow-up jobs (or bounded loop) when `nextCursor` exists.
- [ ] Tests pass.
- [ ] Documentation updated.

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
