# Implementation Plan: Offer-creation detail-page surface + variant-picker pagination (#306 + #308)

**Date**: 2026-04-22
**Status**: Ready for implementation (v2 — tech-review applied)
**Estimated Effort**: ~4 hours total (~3 h for #306, ~1 h for #308)

---

## 1. Task Summary

Two follow-ups from the create-offer-wizard PR (#303, Closes #261), bundled because they close the loop on the same feature:

- **#306** — Surface `OfferCreationStatus` on `listing-detail-page.tsx` for OL-created offers. Adds a backend lookup from `(connectionId, externalOfferId)` → `OfferCreationRecord`, extends `GET /listings/:id` to embed the record when present, and renders the status badge + errors on the detail page.
- **#308** — Paginate the variant picker inside the wizard (currently capped at 10 products).

**Classification**: Mixed — #306 touches CORE (new repository method), Infrastructure (new DB index + migration), Interface (controller + DTO), and Frontend (detail page + type). #308 is Frontend-only.

---

## 2. Scope & Non-Goals

### In Scope
- **Backend**:
  - New port method: `OfferCreationRecordRepositoryPort.findByExternalOfferIdAndConnectionId(externalOfferId, connectionId)` → returns `OfferCreationRecord | null`
  - Implement in `OfferCreationRecordRepository` using TypeORM `findOne` with `{ where: { externalOfferId, connectionId } }`
  - Add a partial composite index `@Index(['externalOfferId', 'connectionId'])` on the ORM entity (only where `externalOfferId IS NOT NULL` via a migration `WHERE` clause so we don't index the many pending/failed rows without an external id)
  - Generate TypeORM migration for the new index
  - Extend `OfferMappingResponseDto` with optional `offerCreation?: OfferCreationStatusResponseDto`
  - Update `ListingsController.getOfferMapping` to call the new repository method when `mapping.entityType === 'Offer'` and embed the record
  - Unit test coverage for new repo method (repository `.spec.ts`) + integration test for the extended controller response (listings integration test)
- **Frontend (#306 half)**:
  - Extend `OfferMapping` FE wire type with optional `offerCreation?: OfferCreationStatusResponse` (reuse the existing type from listings.types.ts)
  - Add `OfferCreationSection` to `listing-detail-page.tsx`: renders the `StatusBadge` + `OfferCreationErrorList` when `mapping.offerCreation` is present; renders nothing otherwise
  - Updates to `listing-detail-page.test.tsx` covering both the "has record" and "no record" paths
- **Frontend (#308 half)**:
  - Add offset state (local `useState`) to `CreateOfferWizard` Step 1
  - Pass offset to `useProductsQuery`; render Prev/Next buttons using existing `.pagination` class
  - Reset offset to 0 when the search input changes (avoid landing on an empty page after narrowing)
  - Update `CreateOfferWizard.test.tsx` with a mock where `total > limit` to cover Prev/Next disable logic

### Out of Scope
- **Extending the listings LIST endpoint to embed `offerCreation`** — the list renders many rows and an N+1 lookup per row is wasteful. The detail page is where the status is expected; the list page already has the post-submit tracker for OL-created offers.
- **Filtering/sorting by creation status on the list** — separate feature.
- **Backfilling `[externalOfferId, connectionId]` tuples for historical rows** — the index is partial and new rows will populate naturally. No data migration needed.
- **URL-persisted offset for the wizard picker** — local `useState` is sufficient since the picker is modal-local (per `docs/frontend-architecture.md` §State Management: "local UI state → component-local useState"). Pagination state resets with the wizard.

### Constraints
- No breaking changes to public API shapes (new DTO field is optional)
- Migration must have both `up()` and `down()` and be runnable via `pnpm --filter @openlinker/api migration:run`
- `pnpm lint` / `pnpm type-check` / `pnpm test` all pass
- `pnpm --filter @openlinker/api migration:show` shows no pending migrations after the run

---

## 3. Architecture Mapping

**Target Layer**: CORE (listings domain port + repository) + Infrastructure (ORM index + migration) + Interface (controller + DTO) + Frontend

**Capabilities Involved**: None new — the OfferCreationRecord persistence already exists from #261. The new repository method is additive.

**Existing Services Reused**:
- `OfferCreationRecordRepositoryPort` (adding one method)
- `OfferMappingRepositoryPort` (unchanged)
- FE: `OfferCreationStatusBadge`, `OfferCreationErrorList`, `OfferCreationStatus` types (all from PR #303)

**New Components Required**:
- 1 new port method + implementation + test
- 1 TypeORM migration
- 1 DTO field on `OfferMappingResponseDto`
- FE wire-type extension
- FE detail-page section
- Wizard pagination controls

**Core vs Integration Justification**: CORE owns the OfferCreationRecord domain and its persistence port. The new lookup is a pure CORE concern (look up a domain entity by a domain-level key). Infrastructure changes (the DB index) are an implementation detail of the port. No adapter / integration code touched.

---

## 4. External / Domain Research

### Internal Patterns (researched in this session)

- **`OfferCreationRecordRepositoryPort`** (`libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts`) already has: `create`, `findById`, `findLatestByVariantAndConnection`, `updateStatus`, `updateExternalOfferId`, `updateExternalIdAndStatus`. The new method fits the existing `findBy*` style.
- **ORM entity** (`libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts`) already has indexes on `[internalVariantId, connectionId]`, `[connectionId]`, `[status]`. Adding `[externalOfferId, connectionId]` (partial, `WHERE externalOfferId IS NOT NULL`) is the natural place to add the new index.
- **Controller** (`apps/api/src/listings/http/listings.controller.ts:101-114`): `getOfferMapping(id)` already injects `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`. The call site has both `mapping.externalId` and `mapping.connectionId` in hand, so looking up the creation record is a one-line addition with zero extra round-trips.
- **`toOfferCreationStatusDto(record)`** helper already exists on the controller (lines 269-281). Reuse it to build the nested DTO.
- **Test harness**: FE tests use `renderWithProviders` + `createMockApiClient`; the `listing-detail-page.test.tsx` already mocks `listings.getById`. Adding a test for the new surface is a natural extension.
- **Pagination pattern** (`apps/web/src/pages/listings/listings-list-page.tsx:110-113, 183-195`): `hasPrev = offset > 0`, `hasNext = offset + PAGE_SIZE < total`, Prev/Next buttons in a `.pagination` div. Modal-local `useState` is the right scope (not URL params — wizard is transient).

### Documentation Gaps
- None material. Existing docs cover the hexagonal layers, naming conventions, migration workflow, and FE patterns relevant to this change.

---

## 5. Questions & Assumptions

### Open Questions
1. **Should the lookup only run when `entityType === 'Offer'`?** Answer: yes — `OfferCreationRecord` only exists for offers. Guarding the call avoids a pointless query for `Product`/`Inventory`/etc. mapping rows. Documented in the plan; enforced in the controller.
2. **Partial vs full index on `[externalOfferId, connectionId]`?** Answer: partial (`WHERE externalOfferId IS NOT NULL`). Rationale: every `pending`/`failed` record before the adapter returns has `externalOfferId = NULL`. A full index would bloat with these non-queryable rows.

### Assumptions
- The `OfferMapping.externalId` field (on `IdentifierMapping` rows with `entityType = 'Offer'`) is the same value as `OfferCreationRecord.externalOfferId` for OL-created offers. Verified via `offer-creation-execution.service` in the worker — the service writes the adapter's returned id both to the record and to the mapping. So the join condition is clean.
- A single `OfferMapping` can only match zero or one `OfferCreationRecord` because external IDs are unique per connection within a marketplace. Multiple creation attempts that retried before an external id was assigned share the same `internalVariantId + connectionId` but don't share an `externalOfferId`. Only the successful attempt writes the id. This justifies using `findOne` rather than `findLatest`.
- The FE wire type `OfferCreationStatusResponse` already exists in `listings.types.ts`; the extended `OfferMapping` type just adds an optional field of that shape. No FE API-client changes required beyond the type.

---

## 6. Proposed Implementation Plan

### Phase 1 — Backend: port + repository + migration

1. **Extend `OfferCreationRecordRepositoryPort`** with the new lookup method.
   - **File**: `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts`
   - **Action**: Add
     ```ts
     /**
      * Look up the record that produced a given marketplace offer. Matches by
      * (externalOfferId, connectionId) so cross-connection collisions do not
      * return a false positive. Returns null when no record has been linked to
      * the offer (i.e. the mapping was synced-in, not OL-created).
      */
     findByExternalOfferIdAndConnectionId(
       externalOfferId: string,
       connectionId: string,
     ): Promise<OfferCreationRecord | null>;
     ```
   - **Acceptance**: Port interface exports the new method; `pnpm type-check` passes.

2. **Implement in repository.**
   - **File**: `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`
   - **Action**: Add method mirroring the existing `findOne` style:
     ```ts
     async findByExternalOfferIdAndConnectionId(
       externalOfferId: string,
       connectionId: string,
     ): Promise<OfferCreationRecord | null> {
       const entity = await this.repository.findOne({
         where: { externalOfferId, connectionId },
       });
       return entity ? this.toDomain(entity) : null;
     }
     ```
   - **Acceptance**: Existing `*.spec.ts` (or new coverage) exercises the method; returns `null` for no-match, domain entity for match.

3. **Add partial composite index on the ORM entity.**
   - **File**: `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts`
   - **Action**: Add the decorator with an **explicit index name** so the migration's `down()` can target it deterministically:
     ```ts
     @Index('IDX_offer_creation_records_external_offer_connection', ['externalOfferId', 'connectionId'], {
       where: '"externalOfferId" IS NOT NULL',
     })
     ```
     alongside the existing `@Index` decorators. The `where` clause makes it partial so pending/failed records (null external id) don't bloat the index. The explicit name avoids TypeORM-generated hash-based names that break when columns are later renamed.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:generate` produces a migration that creates this index with the explicit name.

4. **Generate + verify migration.**
   - **File**: `apps/api/src/migrations/{timestamp}-add-offer-creation-record-external-id-index.ts`
   - **Action**:
     1. Run `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddOfferCreationRecordExternalIdIndex`
     2. `grep -i 'WHERE.*externalOfferId' apps/api/src/migrations/*-add-offer-creation-record-external-id-index.ts` — if no match, TypeORM dropped the partial clause from its diff. Hand-edit the generated `up()` to use a raw `await queryRunner.query(\`CREATE INDEX "IDX_offer_creation_records_external_offer_connection" ON "offer_creation_records" ("externalOfferId", "connectionId") WHERE "externalOfferId" IS NOT NULL\`)`. Matching `down()` becomes `await queryRunner.query(\`DROP INDEX "IDX_offer_creation_records_external_offer_connection"\`)`.
     3. **Verify up/down/up cycle works:** run `pnpm --filter @openlinker/api migration:run`, then `migration:revert`, then `migration:run` again. Each must succeed without error. Then `migration:show` must report no pending.
   - **Acceptance**: Partial `WHERE` clause is present in the committed migration; up-down-up cycle completes cleanly locally.

5. **Unit test the new repository method.**
   - **File**: `libs/core/src/listings/infrastructure/persistence/repositories/__tests__/offer-creation-record.repository.spec.ts` (create if missing, extend if present)
   - **Action**: Mock the TypeORM `Repository` and assert:
     - Returns a domain entity when `findOne` resolves with a match
     - Returns `null` when `findOne` resolves with `undefined`/`null`
     - Passes the correct `where` clause to `findOne`
   - **Acceptance**: 3 new tests pass; method has 100% coverage.

### Phase 2 — Backend: DTO + controller

6. **Extend `OfferMappingResponseDto`.**
   - **File**: `apps/api/src/listings/http/dto/offer-mapping-response.dto.ts`
   - **Action**: Add optional field
     ```ts
     @ApiPropertyOptional({
       nullable: true,
       type: OfferCreationStatusResponseDto,
       description:
         'Populated only by `GET /listings/:id` (detail endpoint) for Offer-type ' +
         'mappings that originated from an OL-initiated create. Always absent on ' +
         'list responses (`GET /listings`) regardless of creation history — the ' +
         'list does not fan-out lookups per row. Absent on synced-in offers and ' +
         'on non-Offer entity types (Product, Inventory, etc.).',
     })
     offerCreation?: OfferCreationStatusResponseDto | null;
     ```
   - Import the existing `OfferCreationStatusResponseDto` from the sibling DTO file.
   - **Acceptance**: Swagger renders the optional nested schema with the "detail-only" behaviour clearly documented; compiled TS accepts `undefined`/`null`/object values.

7. **Update `ListingsController.getOfferMapping`.**
   - **File**: `apps/api/src/listings/http/listings.controller.ts`
   - **Action**: After `findById`, add a conditional lookup:
     ```ts
     const dto = this.toDto(mapping);
     if (mapping.entityType === 'Offer') {
       const record = await this.offerCreationRecords.findByExternalOfferIdAndConnectionId(
         mapping.externalId,
         mapping.connectionId,
       );
       if (record) {
         dto.offerCreation = this.toOfferCreationStatusDto(record);
       }
     }
     return dto;
     ```
   - **Note on architecture**: The listings controller already calls repository ports directly for reads (the existing `getOfferMapping` does `findById` + `toDto` inline). Per `docs/architecture-overview.md` §Layer Dependencies, the strict form is "interfaces → application → domain", but the codebase has chosen to skip the application layer for trivial reads. This PR follows the existing pattern rather than introducing a new use-case wrapper just for this change. When a third read-enrichment lands on this controller, extract a `GetOfferMappingUseCase` to the application layer — tracked as follow-up.
   - **Acceptance**: Detail response includes `offerCreation` for OL-created Allegro offer mappings and omits it for synced-in mappings + non-Offer entity types.

8. **Controller unit spec.**
   - **File**: `apps/api/src/listings/http/listings.controller.spec.ts` (create if missing)
   - **Rationale**: The change is a trivial conditional lookup guarded by `entityType === 'Offer'`. A unit spec that mocks both repository ports gives full coverage of all three branches for milliseconds of runtime. A new integration test file would duplicate coverage the repository spec already provides and does not match `docs/testing-guide.md` §Test Organization: "Integration tests — targeted, focus on critical vertical slices." This is not a critical vertical slice; it's a conditional read-enrichment.
   - **Action**: Mock `OfferMappingRepositoryPort.findById` and `OfferCreationRecordRepositoryPort.findByExternalOfferIdAndConnectionId`. Three cases:
     1. `entityType === 'Offer'` + record present → response includes `offerCreation` with correct shape (asserts `toOfferCreationStatusDto` is applied)
     2. `entityType === 'Offer'` + record absent → response omits `offerCreation`; assert the lookup **was** called
     3. `entityType !== 'Offer'` (e.g., `'Product'`) → response omits `offerCreation`; assert the lookup was **not** called (no wasted query)
   - **Acceptance**: Three new tests pass; the controller has coverage for the branching logic added in step 7.

### Phase 3 — Frontend: detail-page surface (#306 half)

9. **Extend FE wire type.**
   - **File**: `apps/web/src/features/listings/api/listings.types.ts`
   - **Action**: Add to the existing `OfferMapping` interface:
     ```ts
     offerCreation?: OfferCreationStatusResponse | null;
     ```
     Note: `OfferCreationStatusResponse` already exists in this file.
   - **Acceptance**: TypeScript compiles; existing consumers unaffected (optional field).

10. **Update detail page.**
    - **File**: `apps/web/src/pages/listings/listing-detail-page.tsx`
    - **Action**: Add a new section between the `KeyValueList` section and the optional `RawPayloadPanel` context section:
      ```tsx
      {mapping.offerCreation ? (
        <section className="detail-section">
          <div className="listing-detail-offer-creation">
            <div className="listing-detail-offer-creation__header">
              <h3>Offer creation</h3>
              <OfferCreationStatusBadge status={mapping.offerCreation.status} />
            </div>
            {mapping.offerCreation.status === 'failed' ? (
              <OfferCreationErrorList errors={mapping.offerCreation.errors} />
            ) : null}
          </div>
        </section>
      ) : null}
      ```
    - Import `OfferCreationStatusBadge` + `OfferCreationErrorList` from `features/listings/components/`.
    - **Acceptance**: Section renders for mappings with `offerCreation` present; renders nothing for mappings without it.

11. **CSS (minimal).**
    - **File**: `apps/web/src/index.css`
    - **Action**: Add a small block for `.listing-detail-offer-creation` (header flex with badge, `h3` in section-title scale). Reuses existing `--bg-surface`/`--border-subtle` tokens. Under 15 lines.
    - **Acceptance**: Section is visually consistent with other detail sections.

12. **Test the detail page.**
    - **File**: `apps/web/src/pages/listings/listing-detail-page.test.tsx`
    - **Action**: Add two cases:
      - **"renders offer-creation status badge when `offerCreation` is present"** — mock `listings.getById` to return a mapping with `offerCreation: { status: 'active', ... }`. Assert the badge label renders and no error list is shown.
      - **"renders the error list when `offerCreation.status === 'failed'`"** — same shape but `status: 'failed'` with a populated `errors` array. Assert field + message render.
      - **"does not render offer-creation section when `offerCreation` is absent"** — mock with no `offerCreation`. Assert the heading is absent.
    - **Acceptance**: Three new tests pass; existing tests unchanged.

### Phase 4 — Frontend: variant-picker pagination (#308)

13. **Add offset state to the wizard.**
    - **File**: `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
    - **Note on state ownership**: Modal-local `useState`, **not** URL search params. This intentionally diverges from `listings-list-page.tsx` which uses URL params for `offset` — the wizard is transient (a refresh closes it), so URL state would be stale-by-design. Per `docs/frontend-architecture.md` §State Management: "local UI state → component-local `useState`" fits this case (wizard step state + modal-scoped pagination are the same concern).
    - **Action**:
      - Add `const [productOffset, setProductOffset] = useState(0)` alongside the existing `productSearchInput` state
      - Add a constant `const VARIANT_PICKER_PAGE_SIZE = 10;` near the other constants
      - Pass through: `useProductsQuery({ search: debouncedProductSearch || undefined }, { limit: VARIANT_PICKER_PAGE_SIZE, offset: productOffset })`
      - **Reset offset to 0 synchronously from the search `onChange`** (not via a `useEffect` on the debounced value) — the synchronous reset eliminates a race where the debounced search fires with a stale offset before the reset effect runs. The existing search input's `onChange` already updates `productSearchInput`; extend it to also `setProductOffset(0)`.
      - Also reset offset on wizard re-open (the existing reset `useEffect` — add `setProductOffset(0)` there)
    - **Acceptance**: Pagination state is local and resets on search change + wizard re-open; no race between debounce and offset reset.

14. **Render Prev/Next controls.**
    - **File**: same
    - **Action**: Add a footer inside `.create-offer-variant-picker` (below the `ul.create-offer-variant-picker__list`):
      ```tsx
      {(productsQuery.data?.total ?? 0) > VARIANT_PICKER_PAGE_SIZE ? (
        <div className="create-offer-variant-picker__pagination">
          <span className="muted-text">
            {productOffset + 1}–{Math.min(productOffset + VARIANT_PICKER_PAGE_SIZE, productsQuery.data.total)} of {productsQuery.data.total}
          </span>
          <div>
            <Button
              tone="secondary"
              type="button"
              disabled={productOffset === 0}
              onClick={() => setProductOffset((o) => Math.max(0, o - VARIANT_PICKER_PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              tone="secondary"
              type="button"
              disabled={productOffset + VARIANT_PICKER_PAGE_SIZE >= (productsQuery.data?.total ?? 0)}
              onClick={() => setProductOffset((o) => o + VARIANT_PICKER_PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
      ```
    - **Acceptance**: Controls only render when total > page size; Prev disabled on first page, Next on last page; clicking either re-runs the query.

15. **CSS for the pagination footer.**
    - **File**: `apps/web/src/index.css`
    - **Action**: Add `.create-offer-variant-picker__pagination` (flex `space-between`, 0.5rem gap, top border in `--border-subtle`, small font). ~10 lines.
    - **Acceptance**: Fits cleanly at the bottom of the existing variant-picker box.

16. **Test pagination.**
    - **File**: `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx`
    - **Action**: Add one test (plus light edits to existing mocks so the default does not trip the pagination assertions):
      - **"paginates through products when total > limit"** — mock `products.list` to return `{ items: [product], total: 15, limit: 10, offset: 0 }` for the first call and `{ items: [product2], total: 15, limit: 10, offset: 10 }` for the second. Click Next. Assert `products.list` was called with `{ offset: 10 }` on the second invocation. Assert Prev is enabled after clicking Next; Next becomes disabled (total 15, offset 10 + 10 >= 15).
    - **Acceptance**: One new test passes; existing tests continue to pass (the mock default of `total: 1, limit: 10` means pagination controls don't render, so older tests are unaffected).

### Implementation Details

**New files** (5 new, 8 modified):

- **New (backend)**:
  - `apps/api/src/migrations/{timestamp}-add-offer-creation-record-external-id-index.ts`
  - `libs/core/src/listings/infrastructure/persistence/repositories/__tests__/offer-creation-record.repository.spec.ts` (or extend existing)
  - Integration test file OR controller spec file (pick one per step 8)

- **Modified (backend)**:
  - `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts`
  - `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`
  - `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts`
  - `apps/api/src/listings/http/dto/offer-mapping-response.dto.ts`
  - `apps/api/src/listings/http/listings.controller.ts`

- **Modified (frontend)**:
  - `apps/web/src/features/listings/api/listings.types.ts`
  - `apps/web/src/pages/listings/listing-detail-page.tsx`
  - `apps/web/src/pages/listings/listing-detail-page.test.tsx`
  - `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
  - `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx`
  - `apps/web/src/index.css`

**Database Migrations**: 1 — adds a partial composite index. Tested up + down locally.

**Events**: None.

**Configuration Changes**: None.

**Error Handling**:
- The new repository method returns `null` on no-match (matches existing `findBy*` style — no exception)
- Controller silently omits the `offerCreation` field when lookup returns null — this is the expected "synced-in offer" path
- If the lookup fails (DB error), NestJS's default error handler returns 5xx; the detail page already handles this via `query.error` → `ErrorState`

**Reference**: [Engineering Standards — Repository Ports Pattern](../engineering-standards.md#repository-ports-pattern), [Migrations Guide](../migrations.md), [Frontend Architecture — State Management](../frontend-architecture.md#state-management)

---

## 7. Alternatives Considered

### Alternative 1 (for #306): Separate endpoint `GET /listings/connections/:connectionId/offers/:externalOfferId/creation-record`
- **Description**: Option A from the issue body
- **Why Rejected**: Adds a round-trip on every detail-page load for no gain. The controller already has both `externalId` and `connectionId` from the mapping lookup, so embedding the record is one extra local query. A separate endpoint would require the FE to do the coordination.
- **Trade-offs**: Cleaner "one concept per endpoint" separation. But the OfferMapping + OfferCreationRecord are tightly related (a mapping either was OL-created or not), so bundling is honest.

### Alternative 2 (for #306): Extend the LIST endpoint `GET /listings` to include `offerCreation` per row
- **Description**: Show the status on the list without drilling in
- **Why Rejected**: N+1 lookup per row on the list. The list already has the post-submit tracker for in-flight OL-created offers; the detail page is the right place for historical context.
- **Trade-offs**: Would enable filtering/sorting by creation status from the list, but that's a bigger feature.

### Alternative 3 (for #308): Bump `limit` to 50
- **Description**: Cheapest fix
- **Why Rejected**: Silently moves the ceiling without giving operators a way past it. Pagination matches the existing list-page pattern and handles arbitrary catalog sizes.
- **Trade-offs**: Zero-effort fix vs ~30 lines for proper pagination. Proper pagination wins on longevity.

### Alternative 4 (for #308): Infinite scroll via `useInfiniteQuery` + `@tanstack/react-virtual`
- **Description**: Nicer UX with no pagination controls
- **Why Rejected**: Added complexity (scroll handler, observer, virtualization config) for a modal picker that typically resolves to < 20 rows after a search. Pagination is simpler and the operator's mental model already maps to Prev/Next from the listings list.
- **Trade-offs**: Smoother UX on very large catalogs. Acceptable to defer.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Port method lives in `domain/ports/`, implementation in `infrastructure/persistence/repositories/` — repository ports pattern
- ✅ Domain layer has no framework deps; the new method uses only TypeScript types
- ✅ No CORE ↔ Integration boundary touched (pure CORE extension)
- ✅ DTO extension is additive + optional → backwards compatible

### Naming Conventions
- ✅ `findByExternalOfferIdAndConnectionId` matches the existing `findLatestByVariantAndConnection` style
- ✅ Migration file follows `{timestamp}-{description}.ts`
- ✅ FE file names unchanged

### Existing Patterns
- ✅ Controller embeds data via a single lookup (same pattern as the existing `toDto` path)
- ✅ FE pagination mirrors `listings-list-page.tsx`
- ✅ FE detail-page section follows the existing `<section className="detail-section">` pattern

### Risks
- **Migration correctness** — a partial index needs hand-verification after TypeORM generation (TypeORM may drop the `WHERE` clause). Mitigation: review generated SQL; adjust manually if needed.
- **Index selectivity** — the partial index only covers rows with a non-null `externalOfferId`, which is a strong filter. Query plans should use it. If not, `EXPLAIN ANALYZE` in dev.
- **Stale test fixtures** — existing listings controller tests may snapshot the DTO shape. Any snapshot needs updating for the new optional field. Verified during implementation.
- **Pagination: race between search change and offset reset** — if the operator types fast and the debounced search updates before the `useEffect` resets offset, the query fires with a stale offset. Mitigation: reset offset synchronously from the `onChange` of the search input (not via debounced value), so the offset is always 0 by the time the debounce fires.

### Edge Cases
- **Mapping has entity type other than `Offer`** — the guard `if (mapping.entityType === 'Offer')` skips the lookup. Covered by controller test.
- **Mapping with no external id** — `IdentifierMapping.externalId` is never null by schema, so this doesn't apply.
- **OfferCreationRecord has `externalOfferId` but connection mismatch** — the `connectionId` filter eliminates false positives across connections.
- **No products match search after narrowing** — pagination reset to 0 handles this; the picker shows "No products match."

### Backward Compatibility
- ✅ Additive DTO field (optional, nullable)
- ✅ New migration is forward-compatible; `down()` drops the index cleanly
- ✅ No changes to existing endpoints' request shapes

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Repository spec** — `offer-creation-record.repository.spec.ts`: 3 new cases for `findByExternalOfferIdAndConnectionId` (match, no-match, correct `where` clause)
- **Frontend detail page** — `listing-detail-page.test.tsx`: 3 new cases (active status, failed status with errors, absent)
- **Frontend wizard** — `CreateOfferWizard.test.tsx`: 1 new case (paginate forward, verify offset changes + disable logic)

### Integration Tests
- **Listings detail** — `listing-detail-offer-creation.int-spec.ts` (or controller unit spec): validates the controller embeds the record when present + skips for non-Offer entity types. One test file, three cases.

### Mocking Strategy
- Repository spec: mock the TypeORM `Repository<OfferCreationRecordOrmEntity>` with `.findOne` mock
- Frontend tests: `createMockApiClient` with `listings.getById` returning fixtures that include/exclude `offerCreation`
- Integration test: real Postgres via Testcontainers; seed both tables directly, then `supertest` the endpoint

### Acceptance Criteria
- [ ] **#306 AC-1**: `GET /listings/:id` returns `offerCreation` for an OL-created Allegro offer mapping
- [ ] **#306 AC-2**: `GET /listings/:id` does **not** return `offerCreation` for a synced-in mapping (no matching record)
- [ ] **#306 AC-3**: The listing detail page renders `OfferCreationStatusBadge` when `offerCreation` is present
- [ ] **#306 AC-4**: The listing detail page renders `OfferCreationErrorList` when the status is `failed`
- [ ] **#306 AC-5**: The listing detail page renders nothing extra when `offerCreation` is absent
- [ ] **#306 AC-6**: Migration `up → down → up` cycle completes cleanly locally; after the final `up`, `migration:show` reports no pending
- [ ] **#306 AC-7**: Generated SQL contains `WHERE "externalOfferId" IS NOT NULL` (verified via grep on the committed migration file)
- [ ] **#308 AC-1**: Operator can page forward past the first 10 products
- [ ] **#308 AC-2**: Prev disabled on page 1; Next disabled on the last page
- [ ] **#308 AC-3**: Changing the search input resets offset to 0
- [ ] **Quality gate**: `pnpm lint` + `pnpm type-check` + `pnpm test` all pass; explicit up/down/up migration cycle succeeds; `pnpm --filter @openlinker/api migration:show` reports no pending

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (port in domain, impl in infrastructure)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered — the GET endpoint is naturally idempotent; the lookup is read-only
- [x] Rate limits & retries addressed — the new DB lookup is O(1) with the index
- [x] Error handling comprehensive — null-returns on the repository, standard NestJS error mapping on failures
- [x] Testing strategy complete — unit + integration + FE
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Migration follows `docs/migrations.md` (partial index with both up/down)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Migrations Guide](../migrations.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
