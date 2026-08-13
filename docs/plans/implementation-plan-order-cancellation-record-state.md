# Implementation Plan: Capture order cancellation as first-class record state

**Date**: 2026-08-11
**Status**: Draft
**Estimated Effort**: 1–2 days

---

## 1. Task Summary

**Objective**: Make order cancellation a durable, queryable fact on `OrderRecord`, written at the
moment the source reports it — not only if a later poll happens to re-ingest the order.

**Context**: Issue [#1984](https://github.com/openlinker-project/openlinker/issues/1984), part of
the `/analytics` epic (#1976, spec `docs/specs/product-spec-1976-analytics.md` § 1a, dependency
**[C]**). Today `recordStatus` is only `ready | awaiting_mapping | source_deleted` (item-mapping
resolution state — orthogonal to business status), and `handleSourceCancellation`
(`libs/core/src/orders/application/services/order-ingestion.service.ts:485-536`) relays the
cancellation to destinations and returns **without touching the order record at all**. Cancelled
state survives only as a string inside `orderSnapshot.status`, invisible to SQL and only present if
a later poll happens to re-ingest the order through the ordinary `syncOrderFromSource` path.

Consequence: any revenue aggregate built on top of `order_records` would silently include cancelled
orders, and cancellation rate cannot be reported at all.

**Classification**: CORE (`libs/core/src/orders/`) + a nullable, additive migration in
`apps/api/src/migrations/`. No integration/adapter change — the source adapters already report
`status: 'cancelled'` on the neutral `IncomingOrder`/`Order` types; this issue only makes OL persist
that fact durably.

---

## 2. Scope & Non-Goals

### In Scope

- A new nullable `cancelledAt: timestamptz` column on `order_records`, set once and preserved
  thereafter (first-write-wins).
- Writing `cancelledAt` from **both** cancellation-observation paths:
  1. `handleSourceCancellation` — the dedicated cancel-event handler, which today writes nothing.
  2. `OrderRecordService.persistOrder` / `persistIncomingSnapshot` — the ordinary polling/ingestion
     path, for the case where a source's order feed reports `status: 'cancelled'` directly (no
     separate cancel event) or an order is (re-)ingested after cancellation.
- A minimal `OrderRecordFilters` extension (`cancelled?: boolean`) so the fact is queryable/
  excludable from SQL without parsing `orderSnapshot` — satisfying the issue's own "queryable
  without JSON" acceptance criterion. Wiring this into an actual revenue aggregate is explicitly
  deferred to the aggregate issues (#1987/#1988), per ADR-039's own deferral note (see § 4).
- Surfacing `cancelledAt` on `OrderRecordResponseDto` (mirrors the existing `dispatchByAt` /
  `mappingFailureReason` precedent), so the order detail/list already shows the fact.
- One additive migration with a best-effort, explicitly-documented backfill for historical rows.
- Unit tests (core + api) and one integration test.

### Out of Scope

- Refunds (`refunded` is an unwritten `PriceTaxTreatment`-adjacent enum member today — no refund
  amount is stored anywhere; a separate data-capture feature).
- Returns / withdrawals — no return entity exists.
- Restock behaviour on cancellation — already handled by `marketplace.offer.stockRestore` (#1146),
  unchanged by this plan.
- The sales/channel/top-products aggregate endpoints that will *use* the new exclusion filter
  (#1987, #1988) — this issue only makes the exclusion possible.
- Any FE change. The order detail page renders `orderSnapshot` today and is unaffected; a future FE
  slice can add a "Cancelled" badge off the new `cancelledAt` DTO field, but is not required by this
  issue's acceptance criteria.
- Un-cancelling: once `cancelledAt` is set it is never cleared by this plan. No source adapter in
  the repo emits an "uncancelled" transition today, so this is a safe simplification — see
  § 5 Assumptions.

### Constraints

- Must not change existing cancellation-relay behaviour to destinations (explicit acceptance
  criterion).
- Must follow the existing denormalized-scalar-column precedent (`dispatchByAt`, `fulfillmentState`,
  `mappingFailureReason`) rather than overloading `recordStatus` — cancellation is a business fact
  orthogonal to item-mapping resolution state (an order can be `ready` *and* cancelled).
- Migration timestamp ordering: `main`'s current migration tail is
  `1832000000007-add-shipment-waybill-relayed-at.ts`. PR #2014 (issue #1985, order analytics read
  model — **open, not yet merged**) adds `1832000000008-add-order-analytics-read-model.ts` on top of
  that. See § 5 Open Questions for how this plan's migration timestamp must be finalized at
  implementation time.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/`) — domain entity, repository port/impl, application
service. Plus the API interface layer (`apps/api/src/orders/http/`) for DTO surfacing, and
`apps/api/src/migrations/` for schema.

**Capabilities Involved**: None new. This does not touch any capability port
(`OrderSourcePort`, `OrderProcessorManagerPort`) — the neutral `IncomingOrder.status` /
`Order.status` union already includes `'cancelled'` (`libs/core/src/orders/domain/types/order.types.ts:28`)
and every adapter already reports it; this is purely a persistence/read-model change downstream of
that existing contract.

**Existing Services Reused**:
- `OrderRecordService` (`persistOrder`, `persistIncomingSnapshot`) — extended, not replaced.
- `OrderRecordRepository` — new narrow method added, mirroring `updateFulfillmentState` /
  `updateItemResolutionFailure`.
- `OrderIngestionService.handleSourceCancellation` — the load-bearing fix; gets the one new call
  that was missing.

**New Components Required**:
- `OrderRecord.cancelledAt: Date | null` constructor field (domain entity) + `isCancelled` pure
  getter.
- `OrderRecordOrmEntity.cancelledAt` column.
- `OrderRecordRepositoryPort.markCancelled(internalOrderId, cancelledAt)` — new port method, narrow
  absolute-set-once (COALESCE), mirrors `updateFulfillmentState`'s "no-op if row missing" contract.
- A pure helper `deriveCancelledAt(priorCancelledAt, isCancelled, now)` in
  `libs/core/src/orders/domain/order-cancellation-projection.ts` (mirrors the existing
  `order-analytics-projection.ts` pure-helper precedent from #1985), used by `persistOrder` /
  `persistIncomingSnapshot`.
- One migration: adds the column + best-effort backfill.

**Core vs Integration Justification**: Squarely CORE. Cancellation is a cross-cutting order-lifecycle
fact independent of which marketplace/shop reported it; no platform-specific behaviour is
introduced. `handleSourceCancellation` already lives in CORE's `OrderIngestionService` and is the
correct place to durably record the fact — no adapter change is needed because every
`OrderSourcePort` implementation already surfaces cancellation via the existing neutral
`OrderFeedEventType = 'cancelled'` / `IncomingOrder.status = 'cancelled'` contract.

---

## 4. External / Domain Research

### Internal Patterns (codebase search findings)

- **Denormalized scalar precedent**: `dispatchByAt` (#927) and `fulfillmentState` (#1108) are both
  nullable columns on `order_records`, re-derived/pushed at write time rather than parsed from
  `orderSnapshot` on every read. `mappingFailureReason` (#1689) is the closest sibling: a single
  nullable column, one migration, one repository absolute-set method
  (`updateItemResolutionFailure`), surfaced on the response DTO. This plan's `cancelledAt` follows
  the exact same shape.
- **"Claim once, preserve" precedent**: `Shipment.waybillRelayedAt` (documented in
  `docs/architecture-overview.md` § Orders — "Late-arriving waybills reach the source too (#1947)")
  is claimed conditionally (`WHERE "waybillRelayedAt" IS NULL`) precisely because it is a fact that,
  once true, must never be overwritten by a later write. `cancelledAt` has the identical shape: "the
  moment the source reports it" must survive every subsequent re-ingestion of the same order.
- **`handleSourceCancellation` today** (`order-ingestion.service.ts:485-536`): resolves
  `internalOrderId`, applies the ADR-017 destination-echo guard (skip if the order originated from
  a *different* connection than the one reporting the cancel — this is a re-read of an order OL
  itself pushed there as a destination), then calls `orderLifecycleRelay.relay(...)` and returns.
  `existing` (the pre-fetched `OrderRecord`) is already available at this point via
  `this.orderRecordService.getOrderRecord(internalOrderId)` — the plan reuses it, no extra read
  needed for this path.
- **`persistOrder` / `persistIncomingSnapshot` today**
  (`order-record.service.ts`): both build a fresh `OrderRecord` and call
  `repository.upsert()`, which is a **full-object `save()`** — every column on the row is
  overwritten with whatever the freshly-constructed domain entity carries. This is the reason a
  naive "only set `cancelledAt` when status is cancelled, default `null` otherwise" would silently
  **erase** a previously-recorded cancellation on any later re-poll of the same order (the
  reconciliation flow, #904, explicitly re-pulls already-synced orders — "re-pull is authoritative;
  last write wins"). The fix is to read the row's current `cancelledAt` before constructing the new
  entity and carry it through, exactly like `deriveDispatchByAt` re-derives its column on every
  persist but — unlike `dispatchByAt`, which is safely re-derivable from the same source data every
  time — `cancelledAt`'s *first-observed* timestamp is not re-derivable, so it must be preserved,
  not re-derived.
- **`priorStatus` gate already in `syncOrderFromSource`** (lines 246–252, 280, 368): the ingestion
  flow already reads the order's prior business status off the pre-persist snapshot to gate the
  `marketplace.offer.stockRestore` job on the `→ cancelled` **transition**. That gate gets no
  cheaper or more correct by touching `cancelledAt` — it stays exactly as-is (explicit non-goal:
  "Existing cancellation relay behaviour... unchanged" extends to this adjacent stock-restore hook
  too, which is unrelated to the relay but equally must not regress).
- **#1985 / ADR-039** (`docs/architecture/adrs/039-order-analytics-read-model-persistence-strategy.md`,
  PR #2014, branch `1985-order-analytics-read-model`, still open): adds `placedAt`, `currency`,
  `taxTreatment`, `totalAmount` scalar columns plus a new `order_line_items` table to
  `order_records`, migration `1832000000008-add-order-analytics-read-model.ts`. Its own "Cons /
  trade-offs" section states explicitly: *"Cancellation exclusion depends on #1984 landing first
  with its own column; this ADR's tables are designed to be additive and independent of that column
  so the two efforts don't block each other's schema work, but the exclusion predicate itself
  cannot be wired until #1984 merges."* This plan is exactly that follow-up: additive, independent
  schema, no dependency on #1985's columns or table. No coordination is needed beyond the migration
  timestamp (see § 5).
- **PR #2018** (`docs/plans/mockups/analytics-ledger-2003.html`, docs-only visual design package for
  `/analytics`): confirms in its own body that a "Cancellations" KPI card is drawn in the mockup but
  explicitly marked as a currently-**blocked** figure (dashed border, "Data order" tag) — i.e. the
  design already anticipates this issue landing before that card can go live. No code dependency;
  informs only that the eventual FE consumer of `cancelledAt` already has a place to render it.

### External System

Not applicable — no new external API surface. The source adapters (Allegro, PrestaShop, WooCommerce,
Erli) already report cancellation via the existing `OrderSourcePort` contract
(`OrderFeedEventTypeValues` includes `'cancelled'`; `IncomingOrder.status` / `Order.status` include
`'cancelled'`). No adapter code changes.

---

## 5. Questions & Assumptions

### Open Questions

- **Migration timestamp**: at implementation time, `git ls-tree origin/main -- apps/api/src/migrations/`
  must be re-checked. If PR #2014 (#1985) has merged by then, this plan's migration must sort
  *after* `1832000000008-add-order-analytics-read-model.ts` (e.g. `1832000000009`). If #2014 is
  still open, either migration could land first; whichever merges second must rebase its own
  timestamp to sort after the other, per `docs/migrations.md` § Timestamp uniqueness invariant rule
  3 (enforced by `scripts/check-migration-timestamps.mjs` against `origin/main` at lint time — this
  is not something the plan can pre-decide). **Assumption for this plan**: draft the migration as
  `1832000000009-add-order-record-cancelled-at.ts`; re-timestamp at implementation time if it no
  longer sorts strictly after `origin/main`'s tail.
- Should `cancelledAt` also be excluded from the `countByHealth` / `countBySla` KPI-strip aggregates
  on the orders list today? **Assumption**: no — those buckets partition on item-mapping resolution
  state (`recordStatus` + `syncStatus[]`), not business status; a cancelled-but-`ready` order stays
  in whichever health bucket it already occupies. Excluding cancelled orders from *revenue*
  aggregates is the concern of #1987/#1988, not the operational orders-list KPIs. Flagged here in
  case product intent differs.

### Assumptions

- Cancellation is treated as a **monotonic, one-way** fact: once `cancelledAt` is set, nothing in
  this plan clears it. No adapter in the repo emits an "order un-cancelled" signal today (`Order.status`
  union has no such transition documented), so this is safe. If a future source can genuinely
  reverse a cancellation, that is a new, separate design question — not silently absorbed here.
- For **historical rows** where `orderSnapshot.status` (or, for `awaiting_mapping` rows,
  `orderSnapshot->>'status'`) is already `'cancelled'` but `cancelledAt` is `NULL` (every row that
  predates this migration), the migration backfills `cancelledAt := "updatedAt"` as a best-effort
  proxy for "when we last observed the cancellation" — not the true cancellation instant, which
  cannot be reconstructed from data OL already holds. This is called out explicitly in the migration
  file header per the issue's own acceptance criterion ("the backfill or default position for
  historical rows is explicit and documented"). Rows whose snapshot doesn't report `'cancelled'` are
  left `NULL` (default: never cancelled).
- The stock-restore-job transition gate (`priorStatus !== 'cancelled'`, read from the snapshot) is
  left untouched rather than rewired onto `cancelledAt`. They are two independent representations of
  "was this order cancelled before this call": the snapshot-status check already works correctly
  today for its narrow purpose (job-enqueue dedup within a single ingestion call), and rewiring it
  onto the new column would be an unrelated refactor with no acceptance-criterion behind it.
- `markCancelled`'s no-op-when-row-missing behavior (mirroring `updateFulfillmentState`) is accepted
  for the documented residual race (#1160: a cancel event arriving before the order's own create/sync
  job has run). This plan does not attempt to close that race — it is out of scope and explicitly
  flagged as a pre-existing, separately-tracked gap in the architecture doc.

### Documentation Gaps

None identified — `docs/architecture-overview.md` § Orders already documents the neutral
`OrderFeedEventType`/`Order.status` cancellation vocabulary and the existing relay flow in enough
detail to implement against without further discovery.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain — entity, port, pure helper

**Goal**: Introduce the new fact at the domain layer, with no wiring yet.

**Steps**:

1. **Add `cancelledAt` to `OrderRecord`**
   - **File**: `libs/core/src/orders/domain/entities/order-record.entity.ts`
   - **Action**: append a new trailing constructor parameter
     `public readonly cancelledAt: Date | null = null` (after `totalAmount`, following the existing
     pattern of appending new optional fields at the end so old call sites keep compiling), with a
     doc comment mirroring `mappingFailureReason`'s. Add a pure getter:
     ```ts
     /**
      * True once the source has reported this order cancelled (#1984). Pure
      * derivation of an already-loaded field (ADR-011): no I/O, no mutation.
      */
     get isCancelled(): boolean {
       return this.cancelledAt !== null;
     }
     ```
   - **Acceptance**: `libs/core/src/orders/domain/entities/order-record.entity.spec.ts` (new, or
     extend an existing entity spec if one exists) asserts `isCancelled` is `false` for
     `cancelledAt: null` and `true` otherwise.
   - **Dependencies**: none.

2. **Add the pure `deriveCancelledAt` helper**
   - **File**: `libs/core/src/orders/domain/order-cancellation-projection.ts` (new, mirrors the
     existing `order-analytics-projection.ts` sibling from #1985 — a plain function file, no class,
     no I/O)
   - **Action**:
     ```ts
     /**
      * Order Cancellation Projection
      *
      * Pure derivation of the `cancelledAt` scalar to persist on an OrderRecord
      * (#1984). First-write-wins: once a cancellation instant is recorded it is
      * never replaced by a later persist of the same order, even if the source
      * keeps reporting `status: 'cancelled'` on every subsequent poll.
      *
      * @module domain
      */
     export function deriveCancelledAt(
       priorCancelledAt: Date | null,
       isCancelled: boolean,
       now: Date
     ): Date | null {
       if (priorCancelledAt) {
         return priorCancelledAt;
       }
       return isCancelled ? now : null;
     }
     ```
   - **Acceptance**: `order-cancellation-projection.spec.ts` — table-driven: (a) prior null, not
     cancelled → null; (b) prior null, cancelled → `now`; (c) prior set, cancelled → prior
     (unchanged); (d) prior set, not cancelled (an already-cancelled order re-ingested with a
     status that no longer says cancelled — shouldn't happen per source contracts, but must not
     regress) → prior (never cleared).
   - **Dependencies**: none.

3. **Add `markCancelled` to the repository port**
   - **File**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`
   - **Action**: add after `updateItemResolutionFailure`:
     ```ts
     /**
      * Durably record the instant the source reported this order cancelled
      * (#1984), directly from `handleSourceCancellation` — the one ingestion
      * path that never calls `persistOrder`/`persistIncomingSnapshot`.
      * First-write-wins (`COALESCE`): a redelivered cancel event or a later
      * re-poll can never overwrite an already-recorded cancellation instant.
      * No-op (no throw) when the order row doesn't exist yet — mirrors
      * {@link updateFulfillmentState}'s residual-race tolerance (#1160: a
      * cancel event racing ahead of the order's own create/sync job).
      */
     markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void>;
     ```
   - **Acceptance**: compiles; no behavior yet (implemented in Phase 2).
   - **Dependencies**: step 1 (import cleanliness only — no direct type dependency).

### Phase 2: Infrastructure — ORM column, repository implementation, migration

**Goal**: Make `cancelledAt` a real, queryable database column.

**Steps**:

4. **Add the ORM column**
   - **File**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`
   - **Action**: add, mirroring `dispatchByAt`'s decorator shape:
     ```ts
     /**
      * Instant the source reported this order cancelled (#1984). `null` =
      * never cancelled (or a historical row this migration's backfill could
      * not derive a proxy timestamp for). Indexed for the future exclusion
      * predicate (#1987/#1988: `WHERE "cancelledAt" IS NULL`).
      */
     @Column({ type: 'timestamptz', nullable: true })
     @Index()
     cancelledAt!: Date | null;
     ```
   - **Acceptance**: `pnpm --filter @openlinker/core type-check` passes.
   - **Dependencies**: step 4 depends on nothing upstream in this plan; independent of steps 1–3.

5. **Wire `toDomain` / `toOrm` mapping**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: in `toDomain`, pass `entity.cancelledAt` as the new trailing constructor arg; in
     `toOrm`, set `orm.cancelledAt = orderRecord.cancelledAt`.
   - **Acceptance**: existing repository spec's round-trip assertions (`order-record.repository.spec.ts`)
     still pass; add one new case asserting `cancelledAt` round-trips through `toOrm`/`toDomain`.
   - **Dependencies**: step 4.

6. **Implement `markCancelled`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: add near `updateFulfillmentState`/`updateItemResolutionFailure`:
     ```ts
     async markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void> {
       await this.repository.query(
         `UPDATE "order_records"
          SET "cancelledAt" = COALESCE("cancelledAt", $1)
          WHERE "internalOrderId" = $2`,
         [cancelledAt, internalOrderId]
       );
     }
     ```
     (Raw parameterized query — mirrors the existing raw-SQL idiom in `updateSyncStatus` — because
     TypeORM's `Repository.update()` partial-entity API cannot express a `COALESCE(...)`
     right-hand side without an unsafe string-interpolated `() => '...'` function value.)
   - **Acceptance**: new repository spec case — call twice with two different `Date`s for the same
     `internalOrderId`; assert the second call is a no-op (the row keeps the first timestamp).
     Second case: call for a non-existent `internalOrderId`; assert no throw.
   - **Dependencies**: step 4.

7. **Migration**
   - **File**: `apps/api/src/migrations/1832000000009-add-order-record-cancelled-at.ts` (timestamp
     to be reconfirmed at implementation time — see § 5 Open Questions)
   - **Action**:
     ```ts
     /**
      * Add OrderRecord cancelledAt Migration
      *
      * Adds `cancelledAt` (nullable timestamptz) to `order_records` (#1984) —
      * durably records the instant the source reported an order cancelled,
      * independent of `recordStatus` (which tracks item-mapping resolution,
      * not business status).
      *
      * Backfill: for existing rows where the raw snapshot's `status` key
      * already reads 'cancelled' (parsed defensively — some rows carry a
      * pre-mapping IncomingOrder shape, others a resolved Order shape, but
      * both use the same top-level `status` key), sets `cancelledAt :=
      * "updatedAt"` as a best-effort proxy for "the last time we observed
      * this order's cancelled state" — NOT the true cancellation instant,
      * which cannot be reconstructed from data OL already holds. Rows whose
      * snapshot does not report 'cancelled' are left NULL (never cancelled).
      * Idempotent: `WHERE "cancelledAt" IS NULL` re-running this migration
      * (or a from-scratch replay) is a no-op on rows already backfilled.
      *
      * @module apps/api/src/migrations
      */
     import type { MigrationInterface, QueryRunner } from 'typeorm';

     export class AddOrderRecordCancelledAt1832000000009 implements MigrationInterface {
       name = 'AddOrderRecordCancelledAt1832000000009';

       public async up(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(
           `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz`
         );
         await queryRunner.query(
           `CREATE INDEX IF NOT EXISTS "IDX_order_records_cancelledAt" ON "order_records" ("cancelledAt")`
         );
         await queryRunner.query(
           `UPDATE "order_records"
            SET "cancelledAt" = "updatedAt"
            WHERE "cancelledAt" IS NULL
              AND "orderSnapshot"->>'status' = 'cancelled'`
         );
       }

       public async down(queryRunner: QueryRunner): Promise<void> {
         await queryRunner.query(
           `DROP INDEX IF EXISTS "IDX_order_records_cancelledAt"`
         );
         await queryRunner.query(
           `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "cancelledAt"`
         );
       }
     }
     ```
   - **Acceptance**: `pnpm --filter @openlinker/api migration:run` / `migration:revert` both succeed
     locally against the dev Postgres; `pnpm --filter @openlinker/api migration:show` lists it with
     no pending gaps.
   - **Dependencies**: step 4 (column name/type must match the ORM entity exactly).

### Phase 3: Application — wire both cancellation-observation paths

**Goal**: Actually populate `cancelledAt` from the two places cancellation is observed.

**Steps**:

8. **`OrderRecordService.persistOrder`**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
   - **Action**: before constructing the `OrderRecord`, read the row's current `cancelledAt`:
     ```ts
     const priorCancelledAt = (await this.repository.findById(order.id))?.cancelledAt ?? null;
     const cancelledAt = deriveCancelledAt(priorCancelledAt, order.status === 'cancelled', now);
     ```
     Pass `cancelledAt` as the new trailing constructor arg. One extra `findById` per persist call —
     accepted given the documented 10–100 orders/day volume (ADR-039 § Context).
   - **Acceptance**: existing `order-record.service.spec.ts` cases still pass; new cases: (a) a
     fresh, never-before-seen cancelled order gets `cancelledAt` set to (approximately) `now`; (b)
     an order that was already cancelled in a prior `persistOrder` call keeps its original
     `cancelledAt` on a second call with a later `now`.
   - **Dependencies**: Phase 1 step 2, Phase 2 steps 4–5.

9. **`OrderRecordService.persistIncomingSnapshot`**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
   - **Action**: identical pattern, keyed on `incoming.status === 'cancelled'`.
   - **Acceptance**: mirrors step 8's cases, applied to the `awaiting_mapping` path — e.g. a
     cancelled order whose items never resolve still gets `cancelledAt` recorded (satisfies the
     acceptance criterion independent of `recordStatus`).
   - **Dependencies**: Phase 1 step 2, Phase 2 steps 4–5.

10. **`OrderIngestionService.handleSourceCancellation` — the load-bearing fix**
    - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
    - **Action**: immediately after the destination-echo guard (line ~511, after the `existing`
      check) and **before** the `orderLifecycleRelay.relay(...)` call, add:
      ```ts
      await this.orderRecordService.markCancelled(internalOrderId, new Date());
      ```
      Placed before the relay call so the durable record write cannot be lost if the relay itself
      throws (relay failures are pre-existing, unguarded by a try/catch today — out of scope to
      change here). Add `markCancelled` to `IOrderRecordService` as a thin pass-through to the
      repository (mirrors how `updateFulfillmentState`/`markItemResolutionFailure` are exposed).
    - **Acceptance**: **This is the primary fix for the issue's first acceptance criterion.** New
      test in `order-ingestion.service.spec.ts`: a cancel event for a known order calls
      `orderRecordService.markCancelled` exactly once with the correct `internalOrderId`, *before*
      `orderLifecycleRelay.relay` is invoked (assert call order via mock invocation ordering, or via
      two separate `toHaveBeenCalledBefore`-style assertions if the test harness supports it —
      otherwise assert both calls happened and document the intended ordering in a comment). Also:
      the destination-echo-guard early-return path (unknown order / cross-origin echo) does **not**
      call `markCancelled` (no regression on the existing skip branches).
    - **Dependencies**: Phase 1 step 3, Phase 2 step 6.

### Phase 4: Interface — surface on the API response

**Goal**: The operator (and any future FE consumer) can see the fact without querying Postgres
directly.

**Steps**:

11. **`OrderRecordResponseDto` + controller mapping**
    - **Files**: `apps/api/src/orders/http/dto/order-record-response.dto.ts`,
      `apps/api/src/orders/http/orders.controller.ts`
    - **Action**: add, mirroring `dispatchByAt`'s DTO shape exactly:
      ```ts
      @ApiPropertyOptional({
        nullable: true,
        description:
          'Instant the source reported this order cancelled (ISO 8601, #1984). null = never ' +
          'cancelled. Set once and never cleared — a later re-poll of a cancelled order cannot ' +
          'change this timestamp.',
      })
      cancelledAt!: string | null;
      ```
      In `orders.controller.ts#toDto`: `cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,`
    - **Acceptance**: new case in `orders.controller.spec.ts` mirroring the existing
      `'should serialize dispatchByAt as an ISO string, or null when absent (#927)'` case, adapted
      for `cancelledAt`.
    - **Dependencies**: Phase 1 step 1.

12. **`OrderRecordFilters.cancelled` — the queryability acceptance criterion**
    - **Files**: `libs/core/src/orders/domain/types/order-record.types.ts`,
      `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
      (`findMany`)
    - **Action**: add `cancelled?: boolean` to `OrderRecordFilters` with a doc comment explaining it
      maps to `cancelledAt IS [NOT] NULL`; in `findMany`'s `qb` construction, add:
      ```ts
      if (filters.cancelled !== undefined) {
        qb.andWhere(filters.cancelled ? 'rec.cancelledAt IS NOT NULL' : 'rec.cancelledAt IS NULL');
      }
      ```
      **Not** wired into any HTTP query param or FE control in this plan — this satisfies "cancelled
      orders are queryable... sufficient to exclude them from an aggregate or count them on their
      own" (the issue's own wording, matched almost verbatim) as a repository-level capability;
      exposing it as an actual list filter or aggregate predicate is #1987/#1988's job.
    - **Acceptance**: new `order-record.repository.spec.ts` case: seed one cancelled + one
      non-cancelled record, assert `findMany({ cancelled: true }, ...)` and
      `findMany({ cancelled: false }, ...)` each return exactly the expected row.
    - **Dependencies**: Phase 2 step 4.

### Implementation Details Summary

**New Components**:
- **Domain**: `OrderRecord.cancelledAt` + `isCancelled` getter;
  `order-cancellation-projection.ts` (`deriveCancelledAt`); `OrderRecordRepositoryPort.markCancelled`.
- **Application**: `IOrderRecordService.markCancelled` pass-through; `persistOrder` /
  `persistIncomingSnapshot` extended; `handleSourceCancellation` extended.
- **Infrastructure**: `OrderRecordOrmEntity.cancelledAt` column; `OrderRecordRepository.markCancelled`;
  `toDomain`/`toOrm` mapping; `findMany` filter clause.
- **Interface**: `OrderRecordResponseDto.cancelledAt`; controller `toDto` mapping.

**Configuration Changes**: None.

**Database Migrations**: One — `apps/api/src/migrations/1832000000009-add-order-record-cancelled-at.ts`
(see Phase 2 step 7; timestamp reconfirmed at implementation time per § 5).

**Events**: None emitted or consumed. This plan deliberately does **not** introduce a new domain
event (e.g. an `order.cancelled` event on the `events.master.deletion`-style stream) — the existing
`OrderLifecycleRelay` call already carries the cross-cutting notification responsibility for
cancellation, and adding a second notification channel for the same fact is unjustified scope for
this issue.

**Error Handling**: No new domain exceptions. `markCancelled`'s no-op-on-missing-row behavior is a
deliberate design choice (documented in step 3/6), not an error path.

---

## 7. Alternatives Considered

### Alternative 1: Add `'cancelled'` as a fourth `OrderRecordStatus` value

- **Description**: Extend `OrderRecordStatusValues` to `['ready', 'awaiting_mapping',
  'source_deleted', 'cancelled']` instead of a separate column.
- **Why Rejected**: `recordStatus` tracks item-mapping resolution state, which is orthogonal to
  business/cancellation status — an order can be fully `ready` (all items resolved) *and*
  cancelled. Folding both concerns into one enum would make the two facts mutually exclusive when
  they aren't, and would require every existing `recordStatus`-branching call site (health-bucket
  derivation, mapping-failure UI, item-resolution retry logic) to also reason about cancellation,
  which was explicitly not their contract.
- **Trade-offs**: A single-column boolean-ish enum is marginally simpler to query
  (`recordStatus = 'cancelled'` vs. `cancelledAt IS NOT NULL`), but at the cost of conflating two
  independent facts — exactly the anti-pattern the architecture doc's precedent
  (`dispatchByAt`/`fulfillmentState` as separate orthogonal columns) was designed to avoid.

### Alternative 2: A boolean `isCancelled` column instead of a nullable timestamp

- **Description**: `isCancelled: boolean NOT NULL DEFAULT false` instead of `cancelledAt: timestamptz NULL`.
- **Why Rejected**: The issue's own acceptance criteria explicitly require the *time* to be
  recorded, not just the fact ("an order cancelled today should not silently alter last month's
  reported figures") — a plain boolean cannot support "cancelled orders from January" vs.
  "cancelled orders from August" bucketing that a future analytics slice will need. A nullable
  timestamp captures both the fact (`IS NOT NULL`) and the time in one column, with no redundant
  pair of columns to keep in sync.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Follows hexagonal layering: domain entity/port change → infrastructure implementation →
  application wiring → interface surfacing, in that dependency order.
- ✅ CORE-only change; no capability port touched; no adapter code changes.
- **Reference**: `docs/architecture-overview.md` § Orders, § Hexagonal Architecture Structure.

### Naming Conventions
- ✅ `cancelledAt` matches the existing `dispatchByAt` / camelCase timestamp-column convention.
- ✅ `order-cancellation-projection.ts` mirrors the `order-analytics-projection.ts` file-naming
  precedent for a pure-function domain module (no `*.entity.ts`/`*.port.ts` suffix needed — it's a
  plain function file, same shape as its sibling from #1985).
- ✅ Migration filename/class both carry the same 13-digit timestamp suffix, per
  `docs/migrations.md` § Timestamp uniqueness invariant.

### Existing Patterns
- ✅ `markCancelled`'s COALESCE-based first-write-wins update directly follows the
  `Shipment.waybillRelayedAt` claim-once precedent documented in the architecture overview.
- ✅ Repository absolute-set methods (`markCancelled`) mirror `updateFulfillmentState` /
  `updateItemResolutionFailure` exactly: narrow, single-column, no read-modify-write race on other
  columns, no-op-not-throw when the row is missing.

### Risks

- **Risk: the extra `findById` read in `persistOrder`/`persistIncomingSnapshot` adds a query to the
  hot ingestion path.** Mitigation: at the documented 10–100 orders/day volume (ADR-039), this is
  negligible; if a future high-volume deployment makes it measurable, the read can be folded into
  the same transaction as the eventual `upsert()` call (a `SELECT ... FOR UPDATE` or a single
  `INSERT ... ON CONFLICT DO UPDATE SET "cancelledAt" = COALESCE(...)` raw upsert) — deferred until
  there's a real number to justify it, matching the ADR-036/ADR-039 "revisit only with real numbers"
  discipline.
- **Risk: migration timestamp collision with PR #2014 (#1985).** Mitigation: documented as an open
  question (§ 5); `scripts/check-migration-timestamps.mjs` will hard-fail `pnpm lint` at
  implementation time if the chosen timestamp doesn't sort strictly after `origin/main`'s tail —
  the fix is a one-line re-timestamp before commit, not a design change.
- **Risk: the backfill's `"updatedAt"` proxy could be significantly later than the true
  cancellation instant** for an order that was cancelled long ago but only recently touched by an
  unrelated write (e.g. a `fulfillmentState` push). Mitigation: this is explicitly documented as a
  best-effort approximation in the migration's own header and in this plan's § 5 Assumptions — the
  alternative (leaving all historical cancelled orders un-flagged, `cancelledAt = NULL`) is strictly
  worse for the epic's stated data-trust goal, since it would silently include real historical
  cancelled orders in future revenue aggregates.

### Edge Cases

- **Cancel event arrives before the order's create/sync job has run** (#1160, known residual):
  `existing` is `null`, `internalOrderId` may not even resolve (no identifier mapping yet) →
  `handleSourceCancellation` returns early at the "unknown order" branch, same as today. If
  `internalOrderId` *does* resolve (mapping created by an earlier partial attempt) but no
  `order_records` row exists yet, `markCancelled` is a documented no-op. Genuinely closing this race
  needs the deferred monotonic/relay-log machinery already called out in the architecture doc for
  ADR-027 — out of scope here.
- **Redelivered cancel webhook/event** (at-least-once delivery is the platform-wide invariant, per
  `docs/architecture-overview.md` § Webhook Ingestion Flow): `markCancelled`'s COALESCE makes a
  second call for the same order a true no-op — no duplicate timestamp drift.
- **An order cancelled, then later re-ingested via the ordinary poll with a *stale* snapshot that
  still says `'cancelled'`**: `deriveCancelledAt` returns the prior value unchanged — no drift.
- **An order whose source stops reporting `'cancelled'` on a later poll** (not expected per any
  adapter's contract today, but defensively handled): `deriveCancelledAt`'s prior-value branch fires
  first regardless of the new `isCancelled` flag, so `cancelledAt` is never cleared — see § 5
  Assumptions for why this is treated as correct-by-design rather than a bug.

### Backward Compatibility
- ✅ Fully additive: new nullable column, new optional trailing constructor param (default `null`),
  new optional DTO field, new optional filter field. No existing call site, test, or API consumer
  breaks.
- ✅ No breaking change to the cancellation-relay contract (`OrderLifecycleRelay.relay` call is
  unchanged — only a preceding, independent write is added).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- `libs/core/src/orders/domain/order-cancellation-projection.spec.ts` — pure `deriveCancelledAt`
  table-driven cases (§ 6 step 2).
- `libs/core/src/orders/domain/entities/order-record.entity.spec.ts` — `isCancelled` getter (new
  file if none exists yet for this entity, otherwise extend).
- `libs/core/src/orders/application/services/order-record.service.spec.ts` — `persistOrder` /
  `persistIncomingSnapshot` cancellation-preservation cases (§ 6 steps 8–9).
- `libs/core/src/orders/application/services/order-ingestion.service.spec.ts` —
  `handleSourceCancellation` now calls `markCancelled` before `relay` (§ 6 step 10); destination-echo
  and unknown-order branches still skip it.
- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.spec.ts` —
  `markCancelled` first-write-wins + no-op-on-missing-row; `findMany({ cancelled })` filter
  correctness; `toDomain`/`toOrm` round-trip.
- `apps/api/src/orders/http/orders.controller.spec.ts` — `cancelledAt` DTO serialization.

### Integration Tests

- One new case in the existing orders integration suite (`apps/api/test/integration/orders/`, file
  TBD at implementation time — extend the closest existing cancellation-relay int-spec if one
  exists, otherwise add a narrow new one): ingest an order, fire a source cancellation event through
  the same path a webhook/poll would, assert `GET /orders/:id` returns a non-null `cancelledAt`;
  fire the cancellation a second time (simulating redelivery), assert the timestamp is unchanged.

### Mocking Strategy

- Mock `OrderRecordRepositoryPort` (not the concrete `OrderRecordRepository`) in
  `order-record.service.spec.ts` and `order-ingestion.service.spec.ts`, per
  `docs/engineering-standards.md` § Mocking Ports.
- The repository spec itself runs against the real Testcontainers Postgres (unit-level repository
  specs in this codebase already do — confirm placement matches the existing
  `order-record.repository.spec.ts` convention, which the codebase search found runs as a `.spec.ts`,
  not an `.int-spec.ts`, presumably against an in-memory or lightly-mocked `Repository<T>`; mirror
  whatever that file's existing setup already does rather than introducing a new pattern).

### Acceptance Criteria

- [ ] A source-reported cancellation is durably recorded on the order record when
  `handleSourceCancellation` runs, independent of any later poll.
- [ ] `cancelledAt IS NOT NULL` (via `OrderRecordFilters.cancelled`) is sufficient to exclude or
  count cancelled orders without touching `orderSnapshot`.
- [ ] `cancelledAt` records the cancellation time, not just the fact.
- [ ] Re-ingesting or re-delivering an already-cancelled order's cancel event does not change
  `cancelledAt`.
- [ ] `OrderLifecycleRelay.relay(...)` call site and its behaviour are byte-for-byte unchanged.
- [ ] Historical rows are backfilled per the documented `"updatedAt"` best-effort proxy, or left
  `NULL` when the snapshot never reported `'cancelled'` — both explicit and documented in the
  migration file.
- [ ] Unit + integration tests added per § 9 above, all passing.
- [ ] `pnpm --filter @openlinker/core lint` / `type-check` and `pnpm --filter @openlinker/api lint`
  / `type-check` all pass with zero new errors/warnings.
- [ ] `pnpm --filter @openlinker/api migration:show` shows the new migration with no gaps.

**Reference**: `docs/testing-guide.md`, `docs/engineering-standards.md` § Testing Standards.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no integration/adapter touched)
- [x] Uses existing patterns (`dispatchByAt`/`mappingFailureReason`/`waybillRelayedAt` precedents;
  no unnecessary new abstraction)
- [x] Idempotency considered (COALESCE first-write-wins; migration backfill is re-runnable)
- [x] Event-driven patterns used where applicable (deliberately does *not* add a redundant new
  event — reuses the existing relay call as the notification path)
- [x] Rate limits & retries — not applicable, no external API call introduced
- [x] Error handling comprehensive (no-op-not-throw for the documented #1160 residual race; no new
  exception types needed)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Orders, § Data Flow
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Migrations Guide](../migrations.md)
- [ADR-039: Order analytics read model persistence strategy](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md)
- Issue [#1984](https://github.com/openlinker-project/openlinker/issues/1984) (this plan)
- Issue [#1985](https://github.com/openlinker-project/openlinker/issues/1985) / PR
  [#2014](https://github.com/openlinker-project/openlinker/pull/2014) — order analytics read model,
  the downstream consumer of this plan's exclusion filter
- PR [#2018](https://github.com/openlinker-project/openlinker/pull/2018) — `/analytics` v1 visual
  design package, whose "Cancellations" KPI card is drawn-but-blocked pending this issue
