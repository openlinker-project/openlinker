# Implementation Plan — Fix bulk-batch at-most-once advancement gate (#1084)

## 1. Goal & layer

**CORE / infrastructure bug fix.** `BulkBatchAdvancementRepository.markAdvancedIfNotExists` never dedups against
real Postgres — it returns `created: result.identifiers.length > 0`, which is **always truthy** for the composite
user-supplied `@PrimaryColumn` PK (`bulkBatchId`, `offerCreationRecordId`). TypeORM echoes the input PK into
`identifiers` even when `ON CONFLICT DO NOTHING` inserted nothing. Result: a worker **retry** of a bulk child
double-counts `succeededCount`/`failedCount` (affects bulk-offer-creation **and** bulk-shop-publish).

**Non-goals:** changing the advancement schema, the progress service, or the retry service. One-line repo fix + tests.

## 2. Research — the correct signal (proven in-repo)

`webhook-delivery.repository.ts:insertIfNew` (#711 Postgres dedup gate) uses the identical `INSERT … ON CONFLICT
DO NOTHING` pattern and detects insert-vs-conflict via the **RETURNING rows**:
`const inserted = (insertResult.raw as Entity[])?.[0]; isNew = !!inserted`. Postgres `RETURNING` yields the
inserted row on insert and **0 rows on conflict**, so `result.raw.length` is the battle-tested signal. `result.identifiers`
is unreliable for non-generated/composite PKs (it reflects the *input*, not the DB outcome).

Retry-flow check: `BulkListingRetryService` (#742) calls `deleteForRecord(batchId, recordId)` before re-enqueuing a
failed child — so the retry wave's re-advance inserts a fresh row (`created: true`) and counts. That delete only makes
sense if the gate is meant to dedup; the fix restores the intended design. No existing test does a
duplicate-advance-*without*-delete (the untested path that surfaced the bug), so none breaks.

## 3. Design / steps

1. **Fix the gate** — `libs/core/src/listings/infrastructure/persistence/repositories/bulk-batch-advancement.repository.ts`:
   change `created: result.identifiers.length > 0` → `created: (result.raw as unknown[]).length > 0` (mirroring the
   webhook gate). Update the file-header comment (it currently documents the wrong `identifiers` signal).
   - AC: a second `markAdvancedIfNotExists(batchId, sameRecordId)` returns `{ created: false }`.

2. **Unit spec** — `…/repositories/__tests__/bulk-batch-advancement.repository.spec.ts` (new): mock the TypeORM
   repository's `createQueryBuilder().insert().values().orIgnore().execute()` chain to return `{ raw: [{}] }`
   (insert) vs `{ raw: [] }` (conflict); assert `created` maps `true`/`false`. Validates the signal logic without a DB.

3. **Int-spec (real-DB dedup)** — re-add the duplicate-advance assertion to
   `apps/api/test/integration/listings/bulk-shop-publish.int-spec.ts` (the one removed in #1044's CI fix): advance a
   child once (counter → 1), advance the **same** child again → `advanceBatchStatus` returns `null` (gate skip) and the
   counter holds at 1. This is the first real-DB coverage of the dedup path. (Runs in CI; no local Docker.)

## 4. Validation / risks

- **Shared infra** — used by bulk-offer (#737/#742) + bulk-shop-publish (#1044). The fix only changes the
  duplicate-without-delete path (was double-counting, now a no-op); the normal once-per-child and delete-then-readvance
  paths are unchanged. Run the **full** `pnpm test` (offer-bulk progress/submit/retry unit specs) + `pnpm test:integration`
  in CI.
- **No migration** (no schema change). **No barrel/contract change** (repo internals only).
- Confidence is high (proven webhook precedent); the int-spec is the CI guard since local Docker is unavailable.

## 5. Pre-implement gate

Skipped — trivial, self-contained one-line infra fix with no new ports/services/tokens/ORM/barrel surface. The reuse
+ contract-break classes the gate guards against don't apply.
