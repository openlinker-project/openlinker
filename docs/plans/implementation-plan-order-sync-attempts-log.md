# Implementation Plan — Per-destination attempts log on `OrderRecord` (#456)

## 1. Goal & Non-goals

**Goal:** Preserve the timeline of per-destination sync attempts on an `OrderRecord` so a successful retry no longer erases the failed attempt that triggered it. The Activity panel on the order detail page must show **failed → retried → synced** as three distinct rows with real timestamps and the original error.

**Layer classification:**
- **CORE (Orders bounded context):** new `SyncAttempt` domain type, ORM column, repository write, service write — all in `libs/core/src/orders/`.
- **Interface (API):** DTO + controller mapping.
- **Frontend:** transport types, timeline render switch.

**Non-goals (explicit):**
- Joining `sync_jobs` into the order timeline. Rejected by the issue and architecturally — keeps the Orders/Sync-Manager bounded contexts independent.
- Showing attempts on the order list page — detail page only.
- Tracking webhook deliveries / poll runs on the timeline.
- Backfilling history for orders that already exist — column starts at `[]` for them.

## 2. Architecture summary

The change keeps the existing `syncStatus` JSONB column intact ("current state per destination") and **adds** a sibling `syncAttempts` JSONB column ("append-only history per destination, capped at 20 per destination").

`OrderRecordService.updateSyncStatus()` becomes the single write site that both:
1. upserts the current-state row in `syncStatus` (existing behavior), and
2. appends a `SyncAttempt` to `syncAttempts` (new behavior).

The repository implementation is rewritten from `findOne` + mutate + `save` (read-modify-write race) to a **single `UPDATE` statement** using JSONB expressions. Concurrent worker writes serialize at the row level on a single statement, so no attempts are lost even when fan-out / retry hit the same row in parallel.

The Activity timeline switches from `syncStatus` → `syncAttempts`. The Sync Status table (and retry-button visibility, failed-orders banner) stay on `syncStatus`.

## 3. Step-by-step plan

### Phase A — Backend domain & ORM

**A1. Domain types extracted to a new file**
- New file: `libs/core/src/orders/domain/types/order-sync.types.ts`
- Move the existing `OrderSyncStatus` interface out of `order-record.entity.ts` into this file (cleans up an existing engineering-standards violation while we're already touching the file).
- Add `SyncAttempt` interface alongside it:
  ```ts
  export interface SyncAttempt {
    destinationConnectionId: string;
    status: 'pending' | 'syncing' | 'synced' | 'failed';
    attemptedAt: Date;
    error?: string;
    externalOrderId?: string;
    externalOrderNumber?: string;
  }
  ```
- Add the cap constant — single source of truth for both the SQL and the FE link trigger:
  ```ts
  export const SYNC_ATTEMPTS_PER_DESTINATION_CAP = 20;
  ```
- Re-export from `libs/core/src/orders/index.ts` so `OrderSyncStatus`, `SyncAttempt`, and the cap constant are available to API/FE callers (FE only consumes the cap value via the BE response — no runtime import across packages, but if needed the constant lives in a value-importable location).
- Update `order-record.entity.ts` to import these types instead of defining them inline.
- Constructor change: extend `OrderRecord` with `public readonly syncAttempts: SyncAttempt[] = []` as the **last positional parameter, with a default value**. The default keeps every existing `new OrderRecord(...)` call site compiling unchanged (15+ fixtures across `order-record.service.spec.ts`, `order-record.repository.spec.ts`, `order-destination-retry.service.spec.ts`, `orders.controller.spec.ts`).
- File header per `engineering-standards.md` § File Headers.

**A2. ORM JSONB column**
- File: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`
- Add `SyncAttemptJson` interface (sibling of `OrderSyncStatusJson`, with `attemptedAt: string` ISO).
- Add column:
  ```ts
  @Column({ type: 'jsonb', default: () => "'[]'" })
  syncAttempts!: SyncAttemptJson[];
  ```
- Acceptance: TypeORM picks up the column with a `[]` default; existing rows on a fresh build start empty.

**A3. Migration**
- File: `apps/api/src/migrations/1793000000000-add-order-record-sync-attempts.ts`
- Class name: `AddOrderRecordSyncAttempts1793000000000` (timestamp suffix matches filename prefix per `migrations.md` § Timestamp uniqueness invariant).
- Up:
  ```sql
  ALTER TABLE "order_records"
    ADD COLUMN "syncAttempts" jsonb NOT NULL DEFAULT '[]';
  ```
- Down: drop the column.
- No index — reads are always full-row-by-PK, never filtered by JSONB content.
- File header per standards.

**A4. Domain port**
- File: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`
- Update `updateSyncStatus` signature: keep three current params, add a fourth `attempt: SyncAttempt`. Doc-comment makes clear the repository is responsible for both the upsert *and* the append in a single SQL statement.

### Phase B — Backend repository

**B1. Single-statement `updateSyncStatus`**
- File: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
- Replace the `findOne`/mutate/`save` body with a single `UPDATE … WHERE` query built via `repository.createQueryBuilder().update()` so TypeORM still handles parameter binding.
- The `SET` clause does three things:
  1. `"syncStatus"` — drop any existing row for this destination, append the new row at the end. Use `jsonb_build_array` explicitly so the binder can't accidentally collapse object-vs-array semantics:
     ```sql
     "syncStatus" = (
       SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
       FROM jsonb_array_elements("syncStatus") s
       WHERE s->>'destinationConnectionId' != :destId
     ) || jsonb_build_array(:newStatusRow::jsonb)
     ```
  2. `"syncAttempts"` — append the new attempt (wrapped explicitly), then keep only the most-recent N per destination using a window function:
     ```sql
     "syncAttempts" = (
       SELECT COALESCE(jsonb_agg(a ORDER BY ord), '[]'::jsonb)
       FROM (
         SELECT
           a, ord,
           ROW_NUMBER() OVER (
             PARTITION BY a->>'destinationConnectionId' ORDER BY ord DESC
           ) AS recency_rank
         FROM jsonb_array_elements("syncAttempts" || jsonb_build_array(:newAttempt::jsonb))
              WITH ORDINALITY AS t(a, ord)
       ) ranked
       WHERE recency_rank <= :cap
     )
     ```
  3. `"updatedAt" = NOW()`.
- Bind `:cap` from `SYNC_ATTEMPTS_PER_DESTINATION_CAP` (no magic number in SQL).
- Use `.execute()` and check `(result.affected ?? 0) === 0` — if no row matched, throw `OrderRecordNotFoundException`.
- Acceptance: a single SQL statement updates both columns atomically; concurrent writers serialize on the row's exclusive write lock; the per-destination cap is enforced inside the statement.

**B2. `toDomain` / `toOrm` mapping**
- Same repository file. Update both mappers to round-trip `syncAttempts` (parse `attemptedAt` ISO → `Date` and back). Mirror the existing per-field mapping pattern.

**B3. Repository unit-test trim**
- File: `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-record.repository.spec.ts`
- The current `updateSyncStatus` describe block mocks `findOne` + `save`. After the rewrite that path no longer exists, so:
  - Drop the existing `should update existing` / `should add new` cases (they covered the in-memory mutation; the new behavior is SQL-resident and is covered end-to-end by the integration test in B4).
  - Keep one focused unit test: `should throw OrderRecordNotFoundException when no row matched` — mock `createQueryBuilder().update().set().where().execute()` to return `{ affected: 0 }` and assert the exception. This guards the only branch the integration test can't cheaply cover.
- Existing `findById` / `upsert` / `findMany` test blocks are unchanged in scope; they'll just need `syncAttempts: []` populated on the seeded ORM entities so `toDomain` doesn't blow up on `undefined.map`.

**B4. Repository integration test (concurrency + cap)**
- New file: `apps/api/test/integration/order-record-attempts.int-spec.ts` (per `testing-guide.md` § Test Organization — integration tests live under `apps/{api,worker}/test/integration/`, not colocated under `libs/`).
- Reuses the existing `getTestHarness()` / `resetTestHarness()` / `teardownTestHarness()` lifecycle and the `createTestOrderRecord()` fixture.
- Resolves the repository via `harness.getApp().get(ORDER_RECORD_REPOSITORY_TOKEN)` so the test exercises the real bound implementation.
- Test 1 — serial appends preserve order: 3 sequential `updateSyncStatus` calls → final `syncAttempts.length === 3`, in chronological order, with the right statuses (`failed → pending → synced`).
- Test 2 — cap enforcement: append 25 entries for one destination → exactly 20 remain, the oldest 5 dropped, the newest preserved.
- Test 3 — concurrent writes: `Promise.all` of 5 `updateSyncStatus` calls on the same record from different "destinations" → final `syncAttempts.length === 5`, no entry lost. (Concurrent writes to the *same* destination would test the cap-under-contention; we assert no-loss across destinations to demonstrate the row-lock holds.)
- Test 4 — missing row: calling on a non-existent `internalOrderId` throws `OrderRecordNotFoundException`.
- File header per standards.

### Phase C — Backend application service & callers

**C1. Service — set `attemptedAt` and forward**
- File: `libs/core/src/orders/application/services/order-record.service.ts`
- `updateSyncStatus` builds a `SyncAttempt`:
  ```ts
  const attempt: SyncAttempt = {
    destinationConnectionId,
    status: status.status,
    attemptedAt: new Date(),
    error: status.error,
    externalOrderId: status.externalOrderId,
    externalOrderNumber: status.externalOrderNumber,
  };
  await this.repository.updateSyncStatus(internalOrderId, destinationConnectionId, status, attempt);
  ```
- Service interface (`order-record.service.interface.ts`) signature unchanged — the `attemptedAt` semantics stay an implementation detail.
- Acceptance: callers in `order-ingestion.service.ts` and `order-destination-retry.service.ts` need no changes.

**C2. `persistOrder` / `persistIncomingSnapshot`**
- Same file. Both already pass empty `syncStatus: []`; the new constructor default for `syncAttempts` means no source change is required at these factory call sites.

**C3. Service unit-test updates**
- File: `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts`
- Update the `updateSyncStatus` describe block: the repository mock now expects four args. Use `jest.useFakeTimers()` + `jest.setSystemTime(...)` and assert the fourth arg's `attemptedAt` equals the frozen clock.
- Existing `new OrderRecord(...)` fixture calls don't need touching thanks to the constructor default.

**C4. Retry-service spec**
- File: `libs/core/src/orders/application/services/__tests__/order-destination-retry.service.spec.ts`
- Verify both the claim (`failed → pending`) and the revert (`pending → failed`) paths produce repository calls with a fully-formed `SyncAttempt` fourth arg. Existing test structure stays.

**C5. Retry-revert behavior — documented, not suppressed**
- The `OrderDestinationRetryService` claim/revert path will now produce 2-3 attempt rows on enqueue failure (`failed → pending → failed`). This is strictly more informative than today and matches the issue's "preserve every attempt" intent. Decision: keep the simpler implementation, document the new visible behavior in the PR description so reviewers know what to expect on the timeline.

### Phase D — Backend API surface

**D1. New attempt response DTO**
- New file: `apps/api/src/orders/http/dto/sync-attempt-response.dto.ts`
- Mirrors `OrderSyncStatusResponseDto` shape but with `attemptedAt: string` (ISO) and **without** `syncedAt`.
- File header per standards.

**D2. Extend `OrderRecordResponseDto`**
- File: `apps/api/src/orders/http/dto/order-record-response.dto.ts`
- Add `@ApiProperty({ type: [SyncAttemptResponseDto], description: 'Per-destination attempt history (capped at 20 per destination, most recent kept)' }) syncAttempts!: SyncAttemptResponseDto[];`

**D3. Controller mapping**
- File: `apps/api/src/orders/http/orders.controller.ts`
- Extend `toDto` with `syncAttempts: order.syncAttempts.map((a) => this.toSyncAttemptDto(a))` and add the `toSyncAttemptDto` method.

**D4. Controller spec update**
- File: `apps/api/src/orders/http/orders.controller.spec.ts`
- The existing `mockOrder` will get `syncAttempts: []` automatically from the constructor default. Add one focused test asserting the controller maps a non-empty `syncAttempts` through to the DTO.

### Phase E — Frontend

**E1. Transport type**
- File: `apps/web/src/features/orders/api/orders.types.ts`
- Add:
  ```ts
  export const SYNC_ATTEMPTS_PER_DESTINATION_CAP = 20;
  
  export interface SyncAttempt {
    destinationConnectionId: string;
    status: OrderSyncStatusValue;
    attemptedAt: string;
    error: string | null;
    externalOrderId: string | null;
    externalOrderNumber: string | null;
  }
  ```
- Add `syncAttempts: SyncAttempt[]` to `OrderRecord`.
- The cap is hand-mirrored from the BE constant per FE-001 contract strategy (`frontend-architecture.md` § API Client Conventions). Both should change together if the cap is ever tuned.

**E2. Activity timeline switches to attempts**
- File: `apps/web/src/features/orders/components/order-activity-timeline.tsx`
- Prop rename: `syncStatus` → `syncAttempts`.
- Iteration uses the attempt's `attemptedAt` as the row timestamp (always present, drops the "in progress" / null-timestamp branch).
- Tone derives from `attempt.status`; verb from the existing `STATUS_PAST_TENSE` map.
- Row `id` becomes `attempt-${destinationId}-${index}` to keep React keys unique when a destination has multiple rows.
- Update the file header doc-comment to reflect the new data source.

**E3. "View all attempts" deep link when capped**
- Same file. After grouping attempts by destination, when a destination's group has `>= SYNC_ATTEMPTS_PER_DESTINATION_CAP` entries, render a small footer link below that destination's last row pointing to `/sync/jobs?connectionId={sourceConnectionId}` (the source connection — that's where `marketplace.order.sync` jobs are scoped).
- Use `>=` not `===` so the trigger is robust to either a future cap bump or a brief over-the-cap window before the next prune.
- `<Link>` from `react-router-dom`.

**E4. `order-detail-page.tsx` prop rename**
- File: `apps/web/src/pages/orders/order-detail-page.tsx`
- One-line change: `syncStatus={order.syncStatus}` → `syncAttempts={order.syncAttempts}`.

**E5. Timeline tests**
- File: `apps/web/src/features/orders/components/order-activity-timeline.test.tsx`
- Existing tests rewrite to use `syncAttempts` prop with `attemptedAt` instead of `syncedAt`.
- New test: failure → retry → success renders three timeline rows in chronological order with correct tones.
- New test: when a destination has `>= 20` entries, the "View all attempts" link appears with the right href.

**E6. Order detail page spec**
- File: `apps/web/src/pages/orders/order-detail-page.test.tsx` — extend the mocked `OrderRecord` factory with `syncAttempts: []`.

## 4. Architecture compliance check

- Domain layer (`SyncAttempt` interface, `OrderRecord` constructor) has zero framework imports — passes hexagonal rules.
- New `order-sync.types.ts` file aligns with `engineering-standards.md` § Type Definitions in Separate Files (and corrects the existing inline `OrderSyncStatus` violation).
- Repository port lives in `domain/ports/`, ORM-flavored types stay in infrastructure — clean.
- No new dependency from Orders on `sync_jobs` / Sync Manager — the deep link is a URL string, not an import.
- Single-source-of-truth for the cap value: one `SYNC_ATTEMPTS_PER_DESTINATION_CAP` constant, mirrored hand-written into FE per FE-001 contract strategy.
- Migration timestamp `1793000000000` is unique vs. `1792000000000-add-ai-provider-active-setting.ts` (the current latest) and the class suffix matches the filename per `migrations.md` § Timestamp uniqueness invariant.

## 5. Risks & open questions

- **Migration on a populated DB:** the column has a `DEFAULT '[]'` so adding it is a metadata-only operation in PG 11+ (no row rewrite). Confirmed.
- **JSONB statement performance:** the `jsonb_array_elements` + window function runs on at most cap+1 = 21 rows per call — negligible cost.
- **Cap policy:** issue specifies "drop oldest at append" — implemented as "keep most-recent 20 per destination" via window-function rank, same outcome and single-statement-friendly.
- **Retry-revert visibility:** explicitly accepted (see C5) — documented in PR rather than suppressed.

## 6. Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm --filter @openlinker/api migration:show   # confirm migration discovered
pnpm test:integration                          # repository concurrency + cap test
```
