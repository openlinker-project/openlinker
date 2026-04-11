# Implementation Plan: Auto-Match Product Variants to Allegro Offers by SKU/EAN

**Date**: 2026-04-11  
**Status**: Draft  
**Issue**: #135  

---

## 1. Task Summary

**Objective**: Automatically match PrestaShop product variants to Allegro offers using shared identifiers (EAN/GTIN and SKU), eliminating manual mapping friction.

**Context**: Merchants must manually map every variant → offer via identifier mappings. When platforms share EAN/SKU, this can be automated. This implements US-8.

**Classification**: CORE / Application — `libs/core/src/products/application/`

---

## 2. Scope & Non-Goals

### In Scope
- `AutoMatchVariantOffersService` — core matching logic
- `dryRun` mode (preview without persisting)
- Job type `master.variants.autoMatch` + worker handler
- Controller endpoint `POST /connections/:connectionId/sync/auto-match-variants`
- Unit tests for all matching paths

### Out of Scope
- UI for triggering auto-match (future FE issue)
- Partial/incremental matching (this is a full one-shot scan)
- Matching by product name or fuzzy logic

---

## 3. Architecture Mapping

**Target Layer**: CORE Application (`libs/core/src/products/application/services/`)

**Capabilities Involved**:
- `MarketplacePort.listOffers()` — fetch Allegro offers
- `ProductVariantRepositoryPort` — fetch variants with EAN/SKU
- `IIdentifierMappingService.createMapping()` — persist matches

**Existing Services Reused**:
- `OfferMappingSyncService` — pattern reference (not called directly; different iteration direction)
- `OfferLinkingService` — not reused directly (it iterates offers, we iterate variants)
- `normalizeBarcode()` from `@openlinker/core/products`

**New Components**:
1. `auto-match-variant-offers.service.interface.ts` — service interface
2. `auto-match-variant-offers.service.ts` — service implementation
3. `auto-match.types.ts` — result/payload types
4. `auto-match-variants.handler.ts` — worker handler
5. `auto-match-variants.dto.ts` — request/response DTOs
6. Controller endpoint addition to `ListingsController`

**Core vs Integration Justification**: This is platform-agnostic matching logic using ports. It belongs in CORE because it works against `MarketplacePort` and `ProductVariantRepositoryPort` abstractions.

---

## 4. Internal Patterns

**Similar Implementation**: `OfferMappingSyncService` (offer-mapping-sync.service.ts)
- Same dependency injection pattern (INTEGRATIONS_SERVICE_TOKEN, IDENTIFIER_MAPPING_SERVICE_TOKEN, PRODUCT_VARIANT_REPOSITORY_TOKEN)
- Same lookup-building pattern (buildUniqueMap with null for ambiguous)
- Same conflict handling (IdentifierMappingConflictException)

**Key Difference**: Auto-match builds **offer** lookups and iterates **variants** (reverse of offer-mapping-sync which builds variant lookups and iterates offers).

---

## 5. Questions & Assumptions

### Assumptions
- The marketplace connection's `config.masterCatalogConnectionId` identifies the PrestaShop connection (same as offer-mapping-sync)
- `MarketplacePort.listOffers()` returns all active offers when paginated exhaustively
- We match on EAN first (higher confidence), then SKU — matching the issue's priority order
- Ambiguous matches (>1 variant per EAN/SKU, or >1 offer per EAN/SKU) are skipped
- The `createMapping` entity type is `'Offer'` (variant internal ID → offer external ID), matching existing offer-mapping-sync pattern

### Documentation Gaps
- None significant — the issue is well-specified

---

## 6. Proposed Implementation Plan

### Phase 1: Types & Interface

**Step 1**: Create auto-match types
- **File**: `libs/core/src/products/application/types/auto-match.types.ts`
- **Action**: Define `AutoMatchResult`, `AutoMatchOptions`, `MatchError`, `AutoMatchVariantsJobPayload`

**Step 2**: Create service interface
- **File**: `libs/core/src/products/application/services/auto-match-variant-offers.service.interface.ts`
- **Action**: Define `IAutoMatchVariantOffersService` with `autoMatch(connectionId, options)` method

### Phase 2: Service Implementation

**Step 3**: Implement `AutoMatchVariantOffersService`
- **File**: `libs/core/src/products/application/services/auto-match-variant-offers.service.ts`
- **Action**: Implement the matching algorithm:
  1. Get marketplace adapter via `integrationsService.getCapabilityAdapter<MarketplacePort>`
  2. Paginate through all offers, collecting EAN/SKU identifiers
  3. Build `eanToOffer` and `skuToOffer` lookup maps (null for ambiguous)
  4. Load all variants from master connection with non-empty EAN or SKU
  5. For each variant: try EAN match first, then SKU match
  6. If unique match and not `dryRun`: call `identifierMapping.createMapping()`
  7. Track and return `AutoMatchResult`

**Step 4**: Register service in `ProductsModule`
- **File**: `libs/core/src/products/products.module.ts`
- **Action**: Add provider + token binding + export

### Phase 3: Job Infrastructure

**Step 5**: Add job type `master.variants.autoMatch`
- **File**: `libs/core/src/sync/domain/types/sync-job.types.ts`
- **Action**: Add to `JobTypeValues` array

**Step 6**: Create worker handler
- **File**: `apps/worker/src/sync/handlers/auto-match-variants.handler.ts`
- **Action**: Implement `SyncJobHandler`, delegate to `AutoMatchVariantOffersService`

**Step 7**: Register handler
- **Files**: `handler-registration.service.ts`, `sync-worker.module.ts`
- **Action**: Import, inject, and register the new handler

### Phase 4: Controller Endpoint

**Step 8**: Create request/response DTOs
- **File**: `apps/api/src/listings/http/dto/auto-match-variants.dto.ts`
- **Action**: `AutoMatchVariantsRequestDto` (optional `dryRun` boolean), `AutoMatchVariantsResponseDto`

**Step 9**: Add controller endpoint
- **File**: `apps/api/src/listings/http/listings.controller.ts`
- **Action**: Add `POST /connections/:connectionId/sync/auto-match-variants` that enqueues a job and returns `{ jobId }`

### Phase 5: Testing

**Step 10**: Unit tests for `AutoMatchVariantOffersService`
- **File**: `libs/core/src/products/application/services/auto-match-variant-offers.service.spec.ts`
- **Scenarios**:
  - Exact EAN match → mapped
  - Exact SKU match (no EAN) → mapped
  - Ambiguous match (>1 offer for same EAN) → skipped with warning
  - No match → skipped silently
  - `dryRun: true` → result returned, no `createMapping` called
  - Mapping conflict → handled gracefully

---

## 7. Alternatives Considered

### Alternative: Extend OfferMappingSyncService
- **Description**: Add an "auto-match" mode to the existing offer-mapping-sync service
- **Why Rejected**: Different iteration direction (variants→offers vs offers→variants), different result semantics (one-shot summary vs cursor-based), would complicate the existing service
- **Trade-offs**: Less code duplication but higher coupling

### Alternative: Reuse OfferLinkingService directly
- **Description**: Reuse the existing linking service by feeding it synthetic offer feed items
- **Why Rejected**: The linking service is designed for offer→variant direction; forcing variant→offer through it would be awkward

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Service depends on ports only (MarketplacePort, ProductVariantRepositoryPort, IIdentifierMappingService)
- ✅ Types in separate `*.types.ts` file
- ✅ Service implements interface in separate file
- ✅ No framework dependencies in domain layer

### Risks
- **Large catalog performance**: Paginating all offers + loading all variants could be slow for large catalogs. Mitigation: this runs as a background job, not synchronously.
- **Race condition with offer-mapping-sync**: Both services create offer mappings. Mitigation: `getOrCreateExactMapping` handles conflicts gracefully (same as existing pattern).

### Edge Cases
- Variant with both EAN and SKU matching different offers → EAN wins (higher confidence)
- Offer already mapped → `IdentifierMappingConflictException` caught and skipped
- No masterCatalogConnectionId configured → warn and return empty result

### Backward Compatibility
- ✅ No breaking changes — additive only (new job type, new endpoint, new service)

---

## 9. Testing Strategy

### Unit Tests
- `auto-match-variant-offers.service.spec.ts` — 6 scenarios listed above
- Mock: `MarketplacePort`, `ProductVariantRepositoryPort`, `IIdentifierMappingService`, `IIntegrationsService`

### Acceptance Criteria (from issue)
- [ ] Variants with unique EAN match are automatically mapped
- [ ] Variants with unique SKU match are mapped when no EAN present
- [ ] Ambiguous matches (>1 offer) are skipped and logged as warnings
- [ ] `dryRun: true` returns result without persisting mappings
- [ ] Result counts (`matched`, `skippedAmbiguous`, `skippedNoMatch`) are accurate
- [ ] Unit tests cover all paths

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (mirrors OfferMappingSyncService structure)
- [x] Idempotency considered (getOrCreateExactMapping + conflict handling)
- [x] Error handling comprehensive
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
