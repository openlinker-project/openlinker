# Implementation Plan: Surface PublishProductResult.warnings in ProductPublishExecutionService

**Issue**: #1131  
**Date**: 2026-06-23  
**Status**: Ready for Review  
**Estimated Effort**: 3–4 hours  
**Branch**: `1131-publish-warnings-plan`

---

## 1. Task Summary

**Objective**: Make `ProductPublishExecutionService` read and surface `result.warnings` returned by `ShopProductManagerPort.publishProduct` — which it currently silently drops — by (a) logging them as a structured warn and (b) persisting them on the `ListingCreationRecord` via a new `warnings jsonb null` column.

**Context**: `PublishProductResult.warnings?: string[]` is the neutral, non-fatal signal shop adapters use to report fields they could not publish in this call but that did not prevent the product record from being created or updated. The PrestaShop ProductPublisher adapter (PR #1112) is the first consumer: it emits warnings when `content.imageUrls` or `cmd.parameters` are present (deferred — PS WS images need binary multipart upload, PS features need separate resources). Until this issue lands, an adapter can faithfully do its half and flag what it skipped, but the operator never sees it. PR #1112's description claims "operator sees what was skipped and why" — that statement is not true until this core change lands.

**Classification**: CORE / Infrastructure / Application layer — platform-agnostic, benefits every shop adapter (WooCommerce, Shopify, …).

---

## 2. Scope & Non-Goals

### In Scope
- Log non-empty `result.warnings` from `publishProduct` at warn level with structured context: `{ connectionId, internalVariantId, externalProductId, warnings }`.
- Persist warnings on `ListingCreationRecord` as a new `warnings: string[] | null` jsonb column — additive, nullable, backward-compatible.
- TypeORM migration `1810000000000-add-warnings-to-listing-creation-records.ts` for the new column.
- Update `ListingCreationRecord` domain entity, ORM entity, repository, and repository port to thread the new field.
- Extend `product-publish-execution.service.spec.ts` with warning-specific test cases; update existing assertions broken by the API change.
- Document the bulk-path decision: warnings are visible per child record via the existing `getBatch` summary; no aggregate warning counter at batch level.

### Out of Scope
- PrestaShop image multipart upload implementation.
- PrestaShop features/feature-values implementation.
- Parameter projection on PrestaShop or any other adapter.
- Any change to `PublishProductResult` or `ShopProductManagerPort` contracts.
- Marketplace/offer paths (`OfferCreationRecord`, `offer_creation_records`, offer execution).
- REST API endpoints to query warnings (UI integration is a follow-up).
- Integration tests.

### Constraints
- Migration timestamp must be strictly > `1809000000000` (current tail). Use `1810000000000`.
- All existing unit tests must stay green; offer/marketplace paths must remain completely untouched.
- No `any` types. Strict TypeScript throughout.

---

## 3. Architecture Mapping

**Target Layers**:
- **Domain** (`libs/core/src/listings/domain/`) — entity + types + repository port
- **Infrastructure** (`libs/core/src/listings/infrastructure/`) — ORM entity + repository
- **Application** (`libs/core/src/listings/application/`) — execution service + spec
- **App** (`apps/api/src/migrations/`) — migration file

**Capabilities Involved**: `ShopProductManagerPort` (existing, no change to the port).

**Existing Services Reused**:
- `ListingCreationRecordRepository` — extended with `warnings` threading.
- `ProductPublishExecutionService` — amended at the success path after `publishProduct`.
- `Logger` from `@openlinker/shared/logging` — same instance already in the service.

**New Components Required**:
- Migration `1810000000000-add-warnings-to-listing-creation-records.ts` (new file).

**Core vs Integration Justification**: `ProductPublishExecutionService` is CORE — it is the single orchestrator for all shop adapters. The warnings surface must live here so every current and future adapter (`WooCommerceProductPublisherAdapter`, etc.) benefits automatically without any per-adapter changes. Moving the surfacing logic into individual adapters would require every adapter to redundantly log/persist, and would leave the operator blind for adapters that don't implement it.

---

## 4. Internal Patterns (Research)

### Existing Column Pattern: `errors` on `listing_creation_records`
The `errors: jsonb null` column on `ListingCreationRecord` / `listing_creation_records` stores `ListingCreationError[]` for the failure path (builder validation failures, adapter rejections). **It cannot be reused for warnings** — `errors` is populated only when `status = 'failed'`; warnings coexist with `status = 'published'` or `'draft'`. Mixing the two would break the existing invariant that `errors is not null ↔ the publish failed`.

### Similar Pattern: `bulkBatchId` Addition (Migration 1807)
The `bulkBatchId` addition (`1807000000000-add-bulk-batch-id-to-listing-creation-records.ts`) is the direct precedent for an additive nullable column on `listing_creation_records`. The migration guards with `table?.findColumnByName('bulkBatchId')` before adding. The new migration follows the same pattern.

### Structured Warn Log Pattern
Existing warn in `ProductPublishExecutionService.buildResult`:
```
this.logger.warn(`Product publish recorded business_failure. recordId=${record.id} connectionId=${connectionId} errorCount=${record.errors?.length ?? 0}`);
```
The new warn follows the same template-literal style, including the key fields operators need to correlate the warning.

### `toDomain` / `updateExternalIdAndStatus` Threading
The repository maps ORM ↔ domain entities privately. Adding `warnings` follows the same constructor-positional pattern as `bulkBatchId` (appended last, optional default `null`), keeping all existing construction sites unchanged.

### Bulk Path Decision
`BulkListingProgressService.advanceBatchStatus` classifies child outcomes as `succeeded` or `failed`. A publish with warnings is still `outcome = 'ok'` → `succeeded` counter. `BulkShopPublishSubmitService.getBatch` returns all child `ListingCreationRecord` rows, so the UI can already enumerate per-child `warnings` once the column is persisted — no aggregate counter at batch level is needed. **No changes to `BulkListingProgressService`, `BulkShopPublishSubmitService`, or their specs.**

---

## 5. Questions & Assumptions

### Assumptions
- `warnings: string[] | null` (nullable jsonb column) is the right schema. An empty array is never stored — the service writes `null` when `result.warnings` is absent or empty. This mirrors how `errors` treats the no-error case.
- `warnings` is appended as the last optional constructor parameter on `ListingCreationRecord` (default `null`), keeping all N-arg construction sites in tests backward-compatible.
- The `updateExternalIdAndStatus` port method gets an optional `warnings?: string[] | null` parameter appended. The repository interprets `undefined` as "leave unchanged" (same three-valued semantics `errors` already uses), but in practice the execution service always passes an explicit value (`null` or the warnings array).
- The `Logger.warn` method accepts a single string message (matching the existing usage in the file). Structured fields are inlined via template literals. If the logger implementation later gains first-class object context support, the log line can be upgraded.
- No REST/UI endpoint for warnings is needed in this issue — queryability is satisfied by direct DB inspection and the `getBatch` response (which returns full child records).

### Open Questions
- None that are blocking. The "persist or log-only?" decision from the issue is resolved in favour of **persist + log** — log-only is not durable and does not serve the Listings UI.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain Layer

**Goal**: Extend the domain model to carry `warnings` without breaking existing construction sites.

**Step 1.1 — `ListingCreationRecord` entity**
- **File**: `libs/core/src/listings/domain/entities/listing-creation-record.entity.ts`
- **Action**: Append `public readonly warnings: string[] | null = null` as the last constructor parameter (after `bulkBatchId`).
- **Acceptance**: TypeScript compiles; all existing `new ListingCreationRecord(...)` call sites in tests are unaffected because the new parameter is optional with a default.

**Step 1.2 — `CreateListingCreationRecordInput` type**
- **File**: `libs/core/src/listings/domain/types/listing-creation-record.types.ts`
- **Action**: Add `/** Warnings emitted by the adapter on a successful publish. Null when none. */ warnings?: string[] | null;` to `CreateListingCreationRecordInput`.
- **Acceptance**: Existing callers that omit `warnings` continue to compile.

**Step 1.3 — `ListingCreationRecordRepositoryPort`**
- **File**: `libs/core/src/listings/domain/ports/listing-creation-record-repository.port.ts`
- **Action**: Append an optional `warnings?: string[] | null` parameter to `updateExternalIdAndStatus`. Full updated signature:

  ```typescript
  updateExternalIdAndStatus(
    id: string,
    externalProductId: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null,
    warnings?: string[] | null,
  ): Promise<ListingCreationRecord>;
  ```

- **Acceptance**: Existing callers that omit the new argument compile; `ListingCreationRecordRepository` implements the new signature.

---

### Phase 2 — Infrastructure Layer

**Goal**: Add the `warnings` column to the ORM entity, write the migration, and thread the field through the repository.

**Step 2.1 — ORM entity**
- **File**: `libs/core/src/listings/infrastructure/persistence/entities/listing-creation-record.orm-entity.ts`
- **Action**: Add a `warnings` column after `errors`:

  ```typescript
  /**
   * Non-fatal warnings reported by the adapter on a successful publish (#1131).
   * Null when the adapter reported no warnings. Never set on failed records.
   */
  @Column({ type: 'jsonb', nullable: true })
  warnings!: string[] | null;
  ```

- **Acceptance**: TypeORM entity compiles; the `toDomain` mapper update in Step 2.3 can reference `entity.warnings`.

**Step 2.2 — Migration**
- **File**: `apps/api/src/migrations/1810000000000-add-warnings-to-listing-creation-records.ts`
- **Action**: New migration class `AddWarningsToListingCreationRecords1810000000000`:

  ```typescript
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('listing_creation_records');
    if (!table) return;
    if (!table.findColumnByName('warnings')) {
      await queryRunner.query(
        `ALTER TABLE "listing_creation_records" ADD COLUMN "warnings" jsonb`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "listing_creation_records" DROP COLUMN IF EXISTS "warnings"`,
    );
  }
  ```

- The column is nullable jsonb, no index needed. No backfill — all existing rows get `NULL`, which is the correct "no warnings" value.
- **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists the migration as pending; `migration:run` applies it; `migration:revert` drops it cleanly.

**Step 2.3 — Repository**
- **File**: `libs/core/src/listings/infrastructure/persistence/repositories/listing-creation-record.repository.ts`
- **Action**:

  1. **`toDomain`**: pass `entity.warnings` as the new 10th constructor argument:
     ```typescript
     return new ListingCreationRecord(
       entity.id,
       entity.internalVariantId,
       entity.connectionId,
       entity.externalProductId,
       entity.status,
       entity.errors,
       entity.createdAt,
       entity.updatedAt,
       entity.bulkBatchId,
       entity.warnings,   // new
     );
     ```

  2. **`updateExternalIdAndStatus`**: accept and persist `warnings`:
     ```typescript
     async updateExternalIdAndStatus(
       id: string,
       externalProductId: string,
       status: ListingCreationStatus,
       errors?: ListingCreationError[] | null,
       warnings?: string[] | null,
     ): Promise<ListingCreationRecord> {
       const entity = await this.repository.findOne({ where: { id } });
       if (!entity) throw new ListingCreationRecordNotFoundException(id);
       entity.externalProductId = externalProductId;
       entity.status = status;
       if (errors !== undefined) entity.errors = errors;
       if (warnings !== undefined) entity.warnings = warnings;
       const saved = await this.repository.save(entity);
       return this.toDomain(saved);
     }
     ```

  3. **`buildOrmEntity`**: initialize `entity.warnings = input.warnings ?? null;` so records created with warnings from `CreateListingCreationRecordInput` store them correctly (not needed for the execution-service flow, but keeps the input contract complete).

- **Acceptance**: TypeScript compiles; `updateStatus` is unchanged (warnings only flow on the success path, never on `updateStatus`).

---

### Phase 3 — Application Layer

**Goal**: Read `result.warnings` in `executePublish`, log it, and persist it atomically with the status update.

**Step 3.1 — `ProductPublishExecutionService`**
- **File**: `libs/core/src/listings/application/services/product-publish-execution.service.ts`
- **Action**: In `executePublish`, replace the final `updateExternalIdAndStatus` call (currently at line 162) with the warnings-aware version, and add a conditional warn log immediately before it:

  ```typescript
  // Surface non-fatal adapter warnings — log and persist atomically with status.
  if (result.warnings?.length) {
    this.logger.warn(
      `Shop publish completed with non-fatal adapter warnings. connectionId=${input.connectionId} internalVariantId=${input.internalVariantId} externalProductId=${result.externalProductId} warnings=${JSON.stringify(result.warnings)}`,
    );
  }

  const finalRecord = await this.listingRecords.updateExternalIdAndStatus(
    record.id,
    result.externalProductId,
    result.status,
    null,
    result.warnings?.length ? result.warnings : null,
  );
  return this.buildResult(finalRecord, input.connectionId);
  ```

- The log fires before the DB write so a crash on the write doesn't silently suppress the warning (the log is best-effort; the write is authoritative).
- The `null` for `errors` on the success path is already the existing behaviour (unchanged).
- **Acceptance**: When the adapter returns `warnings: ['imageUrls deferred', 'parameters deferred']`, the logger emits a warn-level line and the record row carries the array in its `warnings` column; when the adapter returns no warnings, `logger.warn` is not called for warnings and the column stores `null`.

---

### Phase 4 — Tests

**Goal**: Assert the warnings surface in the execution service spec; keep all other specs green.

**Step 4.1 — Update existing assertions in `product-publish-execution.service.spec.ts`**
- **File**: `libs/core/src/listings/application/services/__tests__/product-publish-execution.service.spec.ts`
- **Action**: The existing two happy-path tests assert `updateExternalIdAndStatus` was called with 4 arguments. After Step 3.1, the call has 5 arguments. Update those two `expect` calls:

  ```typescript
  // 'should publish a new product...' test — was: (null); now:
  expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null, null);

  // 'should treat DuplicateIdentifierMappingError...' test — same update
  expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith('rec-1', EXT, 'published', null, null);
  ```

**Step 4.2 — Add warning-specific test cases**
- **File**: same spec file
- **Action**: Add two new `it` blocks in the `describe('ProductPublishExecutionService')` block:

  1. **`should log a warn and persist warnings when the adapter returns a non-empty warnings array`**
     - Set up `adapter.publishProduct` to return `{ externalProductId: EXT, status: 'published', warnings: ['imageUrls deferred'] }`.
     - Assert `records.updateExternalIdAndStatus` called with the warnings array as 5th argument.
     - Assert `logger.warn` was called (spy on `service['logger'].warn` using `jest.spyOn`).
     - Assert `result.outcome === 'ok'` (warnings do not make the publish fail).

  2. **`should not log a warn and persist null warnings when the adapter returns no warnings`**
     - Use the existing default mock (no `warnings` field on the result).
     - Assert `records.updateExternalIdAndStatus` called with `null` as 5th argument.
     - Assert the logger warn was **not** called (or was called only for the business-failure path, not the warnings path).

- The `logger` spy pattern — since `ProductPublishExecutionService` creates `private readonly logger = new Logger(...)`, spy on the instance field after construction:
  ```typescript
  const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
  ```

- **Acceptance**: `pnpm test` passes with all 7 cases green (5 original + 2 new).

---

## 7. Alternatives Considered

### Alternative 1: Log-only, no persistence
- **Description**: Call `this.logger.warn(...)` when `result.warnings` is non-empty, do not add a DB column.
- **Why Rejected**: Logs are ephemeral and not queryable by operators in the Listings UI. The issue explicitly states "persist them on the `ListingCreationRecord` so they're queryable / shown in the Listings UI next to the published record" as the preferred approach. Log-only also means a bulk summary cannot expose per-child warnings without re-reading adapter state.
- **Trade-offs**: Simpler (no migration), but leaves the operator blind after log rotation.

### Alternative 2: Reuse the `errors` column
- **Description**: Store warnings in the existing `errors: jsonb null` column with a different shape or a `type` discriminator.
- **Why Rejected**: `errors` is the failure-path field — all existing code and UI expects `errors is not null ↔ status = 'failed'`. Conflating warnings (success-path, non-fatal) with errors (failure-path, terminal) would corrupt this invariant and break UI rendering that relies on it.
- **Trade-offs**: No migration needed, but a semantic invariant violation that would require follow-up cleanup.

### Alternative 3: Add a separate `persistWarnings` repository method
- **Description**: Call `updateExternalIdAndStatus` as today (no new arg), then call a new `persistWarnings(id, warnings)` in a second DB round-trip.
- **Why Rejected**: Two writes instead of one introduces a window where the status is updated but warnings are not yet persisted (e.g., process crash between the two writes). The atomic single write (Step 2.3) is more correct.
- **Trade-offs**: Easier port signature extension, but at the cost of data consistency.

### Alternative 4: Aggregate warnings count at bulk-batch level
- **Description**: Add a `warningCount` counter to `BulkListingBatch` incremented when a child publishes with warnings.
- **Why Rejected**: The `getBatch` summary already returns full child `ListingCreationRecord` rows, so any UI that wants a warning count can derive it client-side. A counter adds a schema change + migration for the batch table + progress service logic for a metric that is trivially derivable. Deferred unless the UI proves the aggregation is necessary.
- **Trade-offs**: More ergonomic for a single-number "warnings occurred" badge, but over-engineering relative to the issue scope.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Changes stay within the listings bounded context; no cross-context imports introduced.
- ✅ Domain entity remains anemic (new `warnings` field is read-only data, no behaviour).
- ✅ Repository port extended via optional parameter — existing implementors are backward-compatible.
- ✅ ORM entity change is in the infrastructure layer; domain entity has no TypeORM annotations.

### Naming Conventions
- ✅ Column name `warnings` mirrors the field name on `PublishProductResult.warnings` — no translation needed.
- ✅ Migration class name follows `PascalCase{Timestamp}` convention.
- ✅ No new service classes or ports — no new naming decisions required.

### Existing Patterns
- ✅ Migration guard (`table.findColumnByName`) matches the `1807` migration precedent.
- ✅ `toDomain` pattern matches existing repository mapper style.
- ✅ `updateExternalIdAndStatus` with optional trailing param matches the `errors?` precedent on the same method.

### Risks

**Risk: `Logger.warn` signature mismatch**  
If `LoggerPort.warn` does not accept a string (unlikely — it matches the existing call in the service), the log line would fail to compile. Mitigated by using the same template-literal string form already in the file.

**Risk: `entity.warnings` uninitialized on rows pre-dating the migration**  
Nullable jsonb column reads as `null` from TypeORM on existing rows — `toDomain` passes `entity.warnings` (which is `null`) to the constructor, which is the correct default. No backfill needed.

**Risk: Existing spec assertions break on the 5th `updateExternalIdAndStatus` argument**  
Two existing `expect(records.updateExternalIdAndStatus).toHaveBeenCalledWith(...)` calls will fail until updated per Step 4.1. This is an intentional, bounded breakage — exactly the tests that need updating are identified.

### Edge Cases

**Empty warnings array from adapter**: `result.warnings = []` — the service checks `result.warnings?.length` (truthy only when non-zero), so an empty array is treated identically to `undefined`: no log, column stores `null`. Correct.

**Upsert path (existing externalProductId)**: Follows the same code path after `adapter.publishProduct` — warnings are logged and persisted identically on upsert and create. Correct.

**Rejection path (`ProductPublishRejectedException`)**: Execution falls into the `catch` block and calls `updateStatus` (not `updateExternalIdAndStatus`). `updateStatus` has no `warnings` parameter and is not modified — correct, because a rejected publish has no external product id and warnings are meaningless in the failure path.

**Builder validation failure path**: Returns early before `publishProduct` is called. No warnings. `updateStatus` is called. Correct.

**Backward Compatibility**: ✅ The new column is nullable with no default expression required beyond `NULL`. Existing rows are unaffected. The `ListingCreationRecord` constructor parameter is optional (`= null`). The port method parameter is optional (`warnings?`). No breaking changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **File**: `libs/core/src/listings/application/services/__tests__/product-publish-execution.service.spec.ts`
- Extend existing suite (currently 5 cases → 7 after this change):
  - Update 2 existing assertions to match 5th argument on `updateExternalIdAndStatus`.
  - Add: `should log a warn and persist warnings when adapter returns non-empty warnings`.
  - Add: `should not log warn or persist warnings when adapter returns no warnings`.
- All other spec files in the listings module are untouched (no offers/marketplace paths modified).

### Integration Tests
- None required for this issue — the change is a thin threading of an existing field through already-tested infrastructure.

### Mocking Strategy
- Repository methods stay as `jest.Mock` objects in the spec — `records.updateExternalIdAndStatus` mock is already present; just extend assertions.
- Logger spy: `jest.spyOn(service['logger'], 'warn')` after `service = new ProductPublishExecutionService(...)` in the affected test case (or `beforeEach` if shared).

### Acceptance Criteria
- [ ] `ProductPublishExecutionService.executePublish` logs a warn-level message when `result.warnings` is non-empty; does not log when absent or empty.
- [ ] `listing_creation_records.warnings` column exists (nullable jsonb) after `migration:run`.
- [ ] `ListingCreationRecord` domain entity exposes `warnings: string[] | null`.
- [ ] Repository persists warnings atomically with `externalProductId` + `status` on the success path.
- [ ] Bulk-path decision documented: no aggregate counter at batch level; per-child warnings visible via `getBatch`.
- [ ] `pnpm lint` — zero errors.
- [ ] `pnpm type-check` — zero errors.
- [ ] `pnpm test` — all tests pass (7 cases in execution service spec, rest unchanged).
- [ ] `pnpm --filter @openlinker/api migration:show` lists `1810000000000` as pending before run; shows it applied after run.

---

## 10. Implementation Details

### Files Changed

| File | Change |
|---|---|
| `libs/core/src/listings/domain/entities/listing-creation-record.entity.ts` | Add `warnings: string[] \| null = null` constructor param |
| `libs/core/src/listings/domain/types/listing-creation-record.types.ts` | Add `warnings?` to `CreateListingCreationRecordInput` |
| `libs/core/src/listings/domain/ports/listing-creation-record-repository.port.ts` | Add optional `warnings?` to `updateExternalIdAndStatus` |
| `libs/core/src/listings/infrastructure/persistence/entities/listing-creation-record.orm-entity.ts` | Add `warnings` jsonb column |
| `apps/api/src/migrations/1810000000000-add-warnings-to-listing-creation-records.ts` | **NEW** — additive nullable column migration |
| `libs/core/src/listings/infrastructure/persistence/repositories/listing-creation-record.repository.ts` | Thread `warnings` through `toDomain` + `updateExternalIdAndStatus` + `buildOrmEntity` |
| `libs/core/src/listings/application/services/product-publish-execution.service.ts` | Log + persist warnings on the `publishProduct` success path |
| `libs/core/src/listings/application/services/__tests__/product-publish-execution.service.spec.ts` | Update 2 assertions + add 2 new test cases |

**Total**: 7 modified files + 1 new migration.

### Database Migrations
- **Migration**: `1810000000000-add-warnings-to-listing-creation-records`
- **Table**: `listing_creation_records`
- **Change**: `ADD COLUMN "warnings" jsonb` (nullable, no default expression, no index)
- **Timestamp invariant**: `1810000000000 > 1809000000000` ✅

### Events
- None emitted or consumed.

### Error Handling
- Warnings log is best-effort (fires before the write); a crash after log and before DB write means the row has no warnings but the log has them — acceptable.
- `updateExternalIdAndStatus` throws `ListingCreationRecordNotFoundException` if the record disappeared between load and update — existing behaviour, unchanged.

---

## 11. Alignment Checklist

- [x] Follows hexagonal architecture — domain entity, port, ORM entity, repository, application service each in their own layer
- [x] Respects CORE vs Integration boundaries — no integration code touched; the adapter contract (`PublishProductResult.warnings`) is unchanged
- [x] Uses existing patterns — nullable jsonb column, optional constructor param, `updateExternalIdAndStatus` optional trailing arg
- [x] Idempotency considered — warnings are overwritten on retry (last write wins, which is fine since the adapter re-derives them from the same input)
- [x] Event-driven patterns — N/A for this change
- [x] Rate limits & retries — N/A
- [x] Error handling comprehensive — rejection and builder-failure paths explicitly unchanged
- [x] Testing strategy complete — 2 new unit tests, 2 existing assertions updated
- [x] Naming conventions followed — `warnings` matches the port field; migration class follows the established convention
- [x] File structure matches standards — no new directories; migration in `apps/api/src/migrations/`
- [x] Plan is execution-ready — 8 concrete file-level steps with exact code sketches
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview — Listings bounded context](../architecture-overview.md#6-listings-offers)
- [Engineering Standards — Naming Conventions](../engineering-standards.md#naming-conventions)
- [Engineering Standards — Repository Ports Pattern](../engineering-standards.md#repository-ports-pattern)
- [Engineering Standards — Symbol DI Token Re-export Convention](../engineering-standards.md#symbol-di-token-re-export-convention)
- [Testing Guide](../testing-guide.md)
- [Migrations Guide](../migrations.md)
- ADR-024 (shop destination listing capabilities)
- Issue #1131 (this issue)
- PR #1112 (PrestaShop ProductPublisher — first adapter to emit warnings)
