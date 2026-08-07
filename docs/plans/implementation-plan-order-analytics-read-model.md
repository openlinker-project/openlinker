# Implementation Plan: Order Analytics Read Model

**Date**: 2026-08-07
**Status**: Draft
**Estimated Effort**: 3–4 days

**Source issue**: [#1985](https://github.com/openlinker-project/openlinker/issues/1985) — "[IMPL] Backend — order analytics read model (queryable line items, placed-at, currency, tax treatment)"
**Persistence-strategy decision**: [ADR-039](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md) (already drafted on this branch)
**Spec**: `docs/specs/product-spec-1976-analytics.md` § 1a, § 4 (dependencies [L][T][X][G])

---

## 1. Task Summary

**Objective**: Make order data analytically queryable without JSON expansion — order line items become real rows, and order time / currency / tax treatment become real, indexed columns on `order_records`, per ADR-039's decision.

**Context**: `/analytics` (#1976) needs revenue, unit, and channel-split figures. Today all of that lives only inside `order_records.orderSnapshot` (JSONB): no `order_items` table, no money columns, no indexed order-time column. This plan builds the substrate; it does **not** build any aggregate endpoint (that's #1987/#1988) and does **not** touch cancellation (#1984, independent — see § 2).

**Classification**: CORE (`libs/core/src/orders/` — domain entity, ORM entity, repository, application service) + a new migration in `apps/api/src/migrations/`.

---

## 2. Scope & Non-Goals

### In Scope
- 4 new nullable columns on `order_records`: `placedAt` (timestamptz), `currency` (varchar(3)), `taxTreatment` (varchar), `totalAmount` (numeric) — denormalized from `orderSnapshot` at write time, mirroring the existing `dispatchByAt`/`fulfillmentState` precedent.
- New table `order_line_items` — one row per order line, written transactionally alongside `order_records`.
- Write-path hook: `OrderRecordService.persistOrder` (the only site that persists a `'ready'` order) derives the 4 scalars and the item rows.
- One migration: additive DDL (columns + table + indexes) + an idempotent backfill of existing rows.
- Unit tests for the new derivation logic, the repository, and the idempotent write path.

### Out of Scope (explicitly, per issue #1985 body)
- Any aggregate endpoint (`GET /analytics/...`) — #1987 (sales/channel) and #1988 (top products) build those on top of this substrate.
- FX conversion / a single reporting currency — v1 reports per currency, unchanged here.
- Cost basis, marketplace fees, refunds — not stored anywhere; separate data-capture features.
- Backfilling orders from before OL was connected — this plan backfills existing OL rows only.
- **Cancellation** (#1984) — independent issue, adds its own column to the same table later. Deliberately not referenced anywhere in this plan (see § 8 Risks for why this is safe).
- Splitting into sub-issues — this PR (#2014, branch `1985-order-analytics-read-model`) delivers the full #1985 scope in one pass, per explicit direction for this session.

### Constraints
- `orderSnapshot` (JSONB) is untouched — nothing that reads it today breaks.
- `order_line_items` is populated **only** for `recordStatus === 'ready'` records — `awaiting_mapping`/pre-resolution snapshots hold external, not internal, item refs (see `OrderRecord`'s own doc comment), so writing them would poison the table with non-catalogue ids.
- No new capability port, no new module — this is a same-context (`orders`) schema + write-path change.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/`).

**Capabilities Involved**: None — no `*Port` capability adapter touched; this is intra-context persistence.

**Existing Services Reused**:
- `OrderRecordService.persistOrder` — the single existing write path for a `'ready'` order; extended, not replaced.
- `OrderRecordRepository.upsert` — extended to also write `order_line_items` in the same call.

**New Components Required**:
- `OrderLineItem` domain entity (`libs/core/src/orders/domain/entities/order-line-item.entity.ts`) — anemic, matches `OrderRecord`'s style.
- `OrderLineItemOrmEntity` (`libs/core/src/orders/infrastructure/persistence/entities/order-line-item.orm-entity.ts`).
- `OrderLineItemRepositoryPort` (`libs/core/src/orders/domain/ports/order-line-item-repository.port.ts`) — minimal: `replaceForOrder(orderRecordId, items)`, `findByOrderId(orderRecordId)`. No public HTTP surface in this plan (no controller needed — nothing outside `orders` reads this table yet).
- `OrderLineItemRepository` (`libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts`).
- 4 new fields on `OrderRecord` / `OrderRecordOrmEntity` (no new class).
- One migration in `apps/api/src/migrations/`.

**Core vs Integration Justification**: Pure CORE — this reads/writes OL's own tables from data already resolved by ingestion (internal product/variant ids). No external platform involved, no adapter touched.

---

## 4. External / Domain Research

Already completed in this session (not re-derived here):
- `OrderItem.price` is a **unit price** (confirmed via `AllegroOrderSourceAdapter`: `lineItem.price.amount` maps 1:1 to `OrderItem.price`, and Allegro's own revenue calc does `price * quantity`). Line revenue = `unitPrice × quantity`.
- `Order.placedAt` / `Order.totals.{currency,taxTreatment,total}` already flow into `orderSnapshot` today (`OrderRecordService.persistOrder`) — this plan denormalizes what's already there, adds nothing to ingestion.
- `OrderRecord.recordStatus === 'ready'` is the only state where `items[].productId`/`variantId` are internal ids (per the entity's own doc comment) — governs the population guard above.
- Existing scalar-denormalization precedent: `dispatchByAt` (#927) and `fulfillmentState` (#1108) on the same `OrderRecordOrmEntity` — same pattern, same file, same constructor-parameter style (optional, defaulted, appended at the end).
- Existing idempotent-backfill precedent: `apps/api/src/migrations/1818000000004-backfill-ksef-provider-invoice-number.ts` — a single guarded `UPDATE ... WHERE ... IS NULL`, re-run-safe by construction.
- Migration timestamp tail as of this session: `...1832000000007`. This plan's migration takes the next free synthetic timestamp per `docs/migrations.md`'s ordering rule — confirmed against `origin/main` at implementation time, not hardcoded here.

---

## 5. Questions & Assumptions

### Assumptions
- **No HTTP/DTO surface in this plan.** #1985's own AC list only "queryable," not "exposed" — #1987/#1988 add their own query methods against `order_line_items` directly (mirroring how `countByHealth`/`countBySla` were added straight to `OrderRecordRepository` rather than through a generic query API). This plan therefore does not add a generic `findMany`-style method beyond what the write path itself needs (`findByOrderId`, used only by tests) — downstream issues add what they need when they need it.
- **`order_line_items` does not carry a cancellation-related column.** Per this session's earlier analysis: exclusion is applied by a join back to `order_records` (cheap, PK-indexed) once #1984 lands, not by denormalizing a cancellation flag now — avoids any retrofit to this table later.
- **Backfill runs in the same migration as the schema DDL**, following the KSeF precedent, rather than a separate follow-up migration — the corpus is small (10–100 orders/day persona) so a single-statement backfill is not a performance risk.

### Documentation Gaps
None — ADR-039 already resolved the persistence-strategy question this issue's AC requires.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain — `OrderLineItem` + `OrderRecord` scalar fields

1. **Add 4 fields to `OrderRecord`**
   - **File**: `libs/core/src/orders/domain/entities/order-record.entity.ts`
   - **Action**: Append 4 new optional constructor parameters (default `null`), same style as `dispatchByAt`: `placedAt: Date | null = null`, `currency: string | null = null`, `taxTreatment: PriceTaxTreatment | null = null`, `totalAmount: number | null = null`. Import `PriceTaxTreatment` from `../types/order.types`.
   - **Acceptance**: Existing `new OrderRecord(...)` call sites compile unchanged (new params are optional and appended last).

2. **Add `OrderLineItem` domain entity**
   - **File**: New `libs/core/src/orders/domain/entities/order-line-item.entity.ts`.
   - **Action**: Anemic class — `id`, `orderRecordId`, `lineNumber`, `productId`, `variantId: string | null`, `quantity`, `unitPrice`, `sourceConnectionId`, `placedAt: Date | null`, `createdAt`. No behavior (ADR-011).
   - **Acceptance**: Compiles standalone, no framework import.

3. **Add a pure derivation helper**
   - **File**: New `libs/core/src/orders/domain/order-analytics-projection.ts`.
   - **Action**: `deriveOrderAnalyticsScalars(order: Order): { placedAt: Date | null; currency: string | null; taxTreatment: PriceTaxTreatment | null; totalAmount: number | null }` and `deriveOrderLineItems(order: Order, sourceConnectionId: string): Omit<OrderLineItem, 'id' | 'createdAt'>[]` — both pure, no I/O (ADR-011-adjacent: these aren't entity methods, they're domain-layer pure functions, matching `order-from-ready-snapshot.ts`'s precedent of a standalone domain helper file).
   - **Acceptance**: Unit tests — `deriveOrderLineItems` returns one row per `order.items[]` entry with `lineNumber` = array index, `variantId: null` when absent; `deriveOrderAnalyticsScalars` returns `null` for any absent field (never throws).

### Phase 2: Infrastructure — ORM entities + repository

4. **Add 4 columns to `OrderRecordOrmEntity`**
   - **File**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`
   - **Action**: 4 new `@Column({ nullable: true })` fields, types `timestamptz | null`, `varchar(3) | null`, `varchar | null`, `numeric | null`. Add `@Index()` on `placedAt` and `currency` individually (channel + date-range filters are the two access patterns #1987/#1988 need).
   - **Acceptance**: Compiles; new migration (Phase 4) matches these decorators exactly (`migration:generate` should show a clean diff against this entity, confirmed as part of Phase 4).

5. **Add `OrderLineItemOrmEntity`**
   - **File**: New `libs/core/src/orders/infrastructure/persistence/entities/order-line-item.orm-entity.ts`
   - **Action**: `@Entity('order_line_items')`, `id: uuid` (`@PrimaryGeneratedColumn('uuid')`), `orderRecordId: text` (`@Index()`), `lineNumber: int`, `productId: text` (`@Index()`), `variantId: text | null` (`@Index()`), `quantity: int`, `unitPrice: numeric`, `sourceConnectionId: uuid` (`@Index()`), `placedAt: timestamptz | null`, `createdAt` (`@CreateDateColumn()`). Composite unique index `(orderRecordId, lineNumber)` — the conflict target the idempotent delete-then-reinsert (and later the backfill's `ON CONFLICT DO NOTHING`) relies on.
   - **Acceptance**: Compiles; `@Unique(['orderRecordId', 'lineNumber'])` present.

6. **Add `OrderLineItemRepositoryPort`**
   - **File**: New `libs/core/src/orders/domain/ports/order-line-item-repository.port.ts`
   - **Action**: `replaceForOrder(orderRecordId: string, items: OrderLineItem[]): Promise<void>` (delete existing rows for the order, insert the new set — documented as one logical operation, not necessarily one SQL statement) and `findByOrderId(orderRecordId: string): Promise<OrderLineItem[]>`.
   - **Acceptance**: Interface-only file, no implementation.

7. **Implement `OrderLineItemRepository`**
   - **File**: New `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts`
   - **Action**: `replaceForOrder` runs inside the TypeORM `EntityManager` transaction passed to it (see Phase 3, step 9) — `DELETE FROM order_line_items WHERE "orderRecordId" = $1` then a batched `INSERT`. Private `toDomain`/`toOrm` mappers, matching `OrderRecordRepository`'s style.
   - **Acceptance**: Unit test — given an order with 3 existing line items in the table, calling `replaceForOrder` with 2 new items leaves exactly 2 rows (proves delete-then-reinsert, not append).

8. **Wire the new entity + port into `OrdersModule`**
   - **File**: `libs/core/src/orders/orders.module.ts`, `libs/core/src/orders/orders.tokens.ts`
   - **Action**: Add `OrderLineItemOrmEntity` to `TypeOrmModule.forFeature([...])`. Add `ORDER_LINE_ITEM_REPOSITORY_TOKEN = Symbol('OrderLineItemRepositoryPort')` to `orders.tokens.ts`. Register `OrderLineItemRepository` as a provider bound to that token (`useExisting`), matching the existing `OrderRecordRepository` binding shape.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show`-style module boot doesn't throw (validated in Phase 5 integration smoke, or covered by the existing `app-boot.int-spec.ts` if run).

### Phase 3: Application — write-path hook

9. **Extend `OrderRecordService.persistOrder`**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
   - **Action**: Inject `OrderLineItemRepositoryPort` (new constructor param, token `ORDER_LINE_ITEM_REPOSITORY_TOKEN`). At the end of `persistOrder` (after the `OrderRecord` is upserted and only when the upsert path represents a `'ready'` record — which `persistOrder` always is, per its own doc comment vs. `persistIncomingSnapshot`), call `deriveOrderLineItems(order, sourceConnectionId)` and `this.lineItemRepository.replaceForOrder(record.internalOrderId, items)`. Wrap the two writes (`OrderRecordRepositoryPort.upsert` + `replaceForOrder`) in one transaction — see step 10.
   - **Acceptance**: Unit test — `persistOrder` called twice for the same order (simulating re-ingestion with a changed item list) results in the second call's item set, not a union of both.

10. **Transactional consistency between the two writes**
    - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` (or a small transaction-coordinating change in the service — decide at implementation time based on which keeps the repository ports narrowest)
    - **Action**: The `order_records` upsert and the `order_line_items` replace must commit together or not at all. Simplest correct option given TypeORM's `DataSource`: inject `DataSource` into `OrderRecordService` (or a thin new transaction-runner the two repositories share) and wrap both calls in `dataSource.transaction(async (manager) => { ... })`, passing the transactional `manager` through to both repository calls. This is new — no existing code in this file runs a multi-repository transaction — so it needs its own focused review.
    - **Acceptance**: Integration test (or a unit test with a fake that can assert both-or-neither) — forcing the line-item write to throw leaves the `order_records` row unchanged (rolled back), not partially updated.

### Phase 4: Migration

11. **One additive migration: schema + backfill**
    - **File**: New `apps/api/src/migrations/{next-synthetic-timestamp}-add-order-analytics-read-model.ts`
    - **Action**:
      - `up()`: `ALTER TABLE order_records ADD COLUMN IF NOT EXISTS ...` ×4 + 2 `CREATE INDEX IF NOT EXISTS` (placedAt, currency); `CREATE TABLE IF NOT EXISTS order_line_items (...)` + its indexes + unique constraint; then the backfill — `UPDATE order_records SET placedAt=..., currency=..., taxTreatment=..., totalAmount=... WHERE placedAt IS NULL AND orderSnapshot ? 'placedAt'` (idempotent via the `IS NULL` guard, matching the KSeF precedent) and `INSERT INTO order_line_items (...) SELECT ... FROM order_records CROSS JOIN LATERAL jsonb_array_elements(orderSnapshot->'items') WITH ORDINALITY AS t(item, idx) WHERE "recordStatus" = 'ready' ON CONFLICT ("orderRecordId","lineNumber") DO NOTHING`.
      - `down()`: drop the table, drop the 4 columns. Reversible (unlike the KSeF backfill, this migration's `down` doesn't need to "un-backfill" anything irretrievable — dropping the columns/table is a clean revert).
    - **Acceptance**: `pnpm --filter @openlinker/api migration:run` then `migration:revert` then `migration:run` again succeeds cleanly on a fresh Testcontainers Postgres (proves idempotency and reversibility both hold). Timestamp confirmed strictly greater than `origin/main`'s current tail per `docs/migrations.md`'s ordering rule (checked at implementation time, not fixed here).

---

## 7. Alternatives Considered

*(Superset already covered in [ADR-039](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md) — materialized view, generated columns, live JSONB expansion all rejected there. Not repeated here.)*

**Backfill as a separate follow-up migration vs. same migration as the DDL**: considered separating (mirrors 1985-C from this session's earlier sub-issue breakdown), rejected for this single-PR pass because the corpus is small enough that one migration doing both is not a real risk, and it avoids a second migration file whose only job is "run after the first" — see § 5 Assumptions.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No cross-context import — everything lives inside `libs/core/src/orders/`.
- ✅ Domain entity (`OrderLineItem`) and the projection helper are framework-free (ADR-011).
- ✅ Repository port + Symbol token follow the existing `orders.tokens.ts` convention.

### Risks
- **Transaction wiring (step 10) is the one genuinely new piece of infrastructure in this plan** — everything else mirrors an existing precedent exactly; this doesn't. Budget explicit review time here; a bug means `order_records` and `order_line_items` silently disagree.
- **This plan and #1984 both append fields to `OrderRecord`'s constructor / `OrderRecordOrmEntity` / `OrderRecordRepository`'s mappers.** Confirmed low-risk in this session's earlier analysis: additive-only, same three files, trivially resolved on rebase whichever lands second. No action needed now.
- **`order_line_items` has no cancellation column by design** (§ 5) — #1987/#1988 must join back to `order_records` for the exclusion once #1984 ships. Flagged so a future reviewer doesn't mistake the omission for an oversight.

### Backward Compatibility
- ✅ Fully additive — no existing column type/name changes, no existing method signature changes (only new optional constructor params, appended last).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/domain/order-analytics-projection.spec.ts` — pure-function edge cases (Phase 1 step 3's acceptance criteria).
- `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.spec.ts` — delete-then-reinsert behavior (Phase 2 step 7).
- `libs/core/src/orders/application/services/order-record.service.spec.ts` — re-ingestion replaces, doesn't union, item rows (Phase 3 step 9); transactional all-or-nothing behavior (Phase 3 step 10).

### Integration Tests
- Migration up/revert/up round-trip against a real Testcontainers Postgres (Phase 4 step 11's acceptance criteria) — this is the one piece that genuinely needs real Postgres, per `docs/testing-guide.md`'s guidance to reserve integration tests for DB-dependent behavior.

### Acceptance Criteria (from #1985, mapped to this plan)
- [ ] Order line items queryable per product/variant without JSON expansion — Phase 2.
- [ ] Aggregates filterable/bucketed by order time, with documented fallback (absent `placedAt` ⇒ `null`, consumers fall back to `createdAt` — documented in the column's TSDoc, not enforced here since no aggregate exists yet) — Phase 1/2.
- [ ] Currency a first-class column — Phase 1/2.
- [ ] Tax treatment explicit, `null` = unknown, never defaulted — Phase 1/2.
- [ ] Cancelled orders excludable — deliberately deferred to #1984 + consumers, documented in § 2/§ 5/§ 8.
- [ ] Existing orders backfilled, re-runnable — Phase 4.
- [ ] Persistence strategy recorded with rationale — ADR-039 (already on this branch).
- [ ] Tests added — § 9 above.
- [ ] No new lint/type errors — verified before PR.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture.
- [x] Respects CORE vs Integration boundaries — no integration touched.
- [x] Uses existing patterns — mirrors `dispatchByAt`/`fulfillmentState` denormalization and the KSeF backfill migration precedent.
- [x] Idempotency considered — delete-then-reinsert write path, `IS NULL`/`ON CONFLICT DO NOTHING` backfill.
- [x] Testing strategy complete.
- [x] Naming conventions followed.
- [x] Plan saved as markdown file.

---

## Related Documentation

- [ADR-039](../architecture/adrs/039-order-analytics-read-model-persistence-strategy.md)
- [Architecture Overview](../architecture-overview.md) § Orders
- [Engineering Standards](../engineering-standards.md) § Symbol DI Token Re-export Convention, § ORM ↔ Domain Mapping
- [Migrations Guide](../migrations.md)
