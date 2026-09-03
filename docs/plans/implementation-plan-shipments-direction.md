# Implementation Plan: `shipments.direction` and the four repricing predicates (#2373)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: give `shipments` a `direction` (`outbound | return`) column, recreate the partial unique
index `UQ_shipments_branch_one_per_order_conn` so it can hold an outbound AND a return branch-1 row for
one `(orderId, connectionId)`, and make the four existing shipment read predicates direction-aware so no
pre-existing flow ever observes a return label.

**Context**: ADR-060 carried this forward as a known consequence when returns landed in Wave 1c. Return
labels are shipments, but every shipment predicate in the tree assumes one direction. Today a return
label for an order that already has a branch-1 outbound row cannot be inserted at all — the partial
unique index refuses it — and if it could, the status-sync scan, the order-fulfilment projection and the
dispatch-claim read would all treat it as the order's outbound shipment.

**Classification**: Infrastructure (migration-bearing) with a small domain/application surface.

---

## 2. Scope & Non-Goals

### In scope
- `ShipmentDirection` union + values (`libs/core/src/shipping/domain/types/shipment-direction.types.ts`).
- `direction` on the ORM entity, the domain entity, `CreateShipmentInput`, `ShipmentFilters`, the
  response DTO and the list-query DTO.
- Migration `1862000000000` — add the column NOT NULL with a temporary default, **drop the default in the
  same migration**, recreate the unique index.
- Direction-awareness in the four read predicates.
- Unit + integration tests, including the D8 coexistence regression.
- Documentation: the `§ 22 Returns` carried-forward bullet in `docs/architecture-overview.md`, plus an
  ADR-060 amendment note.

### Out of scope
- Actually creating return labels (no dispatch-path change, no carrier work). Nothing in the tree writes
  `direction: 'return'` after this slice — the column exists and is exercised only by tests.
- Any `returns` ↔ `shipping` module edge.
- Multi-package / multi-parcel shipments.

### Constraints
- Migration slot is fixed at `1862000000000`.
- `shipments` is a live table with a live duplicate guard: the recreated index must not be looser for
  outbound rows than the one it replaces.
- No `synchronize`-visible column default (TypeORM would re-add it, making `direction` unstated-but-present).

---

## 3. Architecture Mapping

**Target layer**: CORE domain types + Infrastructure persistence, plus two API DTOs.

**Capabilities involved**: none. This touches no port and no adapter.

**Existing components reused**: `ShipmentOrmEntity`, `ShipmentRepository`, `ShipmentRepositoryPort`,
`ShipmentFilters`, `ShipmentResponseDto`.

**New components**: one `*.types.ts` (`as const` + union, per engineering-standards) and one migration.

**Core vs Integration**: entirely CORE — direction is a property of OL's own shipment aggregate, not of
any carrier's wire format.

---

## 4. Domain research

### The index, and why the fix goes in the KEY rather than the WHERE

Current definition (`shipment.orm-entity.ts`):

```
UNIQUE (orderId, connectionId) WHERE "providerShipmentId" IS NULL
```

Two candidate changes:

| Candidate | Effect |
|---|---|
| add `direction = 'outbound'` to the **WHERE** | outbound guard preserved; **return rows entirely unguarded** — N branch-1 return rows per `(order, connection)`. Too wide. |
| add `direction` to the **KEY columns** | one branch-1 row per `(order, connection, direction)`. Outbound duplicates still refused (two outbound rows share the discriminator); return duplicates also refused. |

The key-column form is the only one that is neither too narrow (it admits the legitimate outbound+return
pair D8 names) nor too wide (it guards each direction on its own terms). Adopted.

### The four predicates

| # | Predicate | Repository method | Consumer |
|---|---|---|---|
| 1 | by-order listing | `findByOrderId` | `OrderFulfillmentProjectionService` |
| 2 | branch-1 lookup | `findBranchOneByOrderAndConnection` | `FulfillmentStatusSyncService`, `ShipmentDispatchService` |
| 3 | dispatch-claim read | `findActiveByOrderId` | `ShipmentDispatchService` (×2), `ShipmentQueryService` |
| 4 | status-sync scan | `findMany({connectionId, statuses})` | `ShipmentStatusSyncService` |

1–3 take a **required** `direction` argument rather than defaulting to `'outbound'`. A default is a
silent decline: a future call site would read the outbound cohort while believing it read all shipments,
and nothing would say so. A required argument makes every read state its cohort at the call site and
makes omission a compile error.

4 is different and deliberately so: `findMany` also backs the operator-facing `GET /shipments` list. A
hard outbound filter there would make return labels permanently invisible to the operator with no signal.
So `ShipmentFilters` gains an **optional** `direction`, the status-sync scan passes `'outbound'`
explicitly, and the list API exposes `direction` as both a filter and a response field — the operator can
see the cohort rather than having it silently chosen for them.

### What the migration default asserts

The column is added `NOT NULL DEFAULT 'outbound'`, then `ALTER COLUMN "direction" DROP DEFAULT` in the
same `up()`. The default is not a placeholder: every row in `shipments` today was created by
`ShipmentDispatchService` (an operator buying a label for goods going to a buyer) or by
`FulfillmentStatusSyncService`'s branch-1 projection (a marketplace reporting that the seller shipped) —
both outbound by construction, since no code path in the tree has ever been able to create a return
label. `'outbound'` is therefore a true statement about the history, not a guess. Dropping the default
afterwards is what keeps it from becoming an implicit answer for future inserts: the ORM entity declares
no default, so `synchronize` (which the integration harness uses) and the migration converge on the same
shape, and every insert must state its direction.

---

## 5. Questions & Assumptions

**Assumptions**
- Return labels will eventually be bought through the same `ShipmentDispatchService` path (issue's own
  assumption). Nothing here forecloses that; `CreateShipmentInput.direction` is the seam.
- No out-of-tree consumer constructs `Shipment` positionally (the entity's own docblock already warns that
  appended fields go last; `direction` follows the same rule).

**Open questions (recorded, not blocking)**
- Whether a return shipment should be excluded from `OrderFulfillmentProjectionService`'s rollup forever,
  or eventually contribute its own return-side rollup. This slice excludes it; the projection is an
  outbound fulfilment statement.

---

## 6. Implementation Plan

### Phase 1 — Vocabulary
1. `libs/core/src/shipping/domain/types/shipment-direction.types.ts` — `ShipmentDirectionValues` (`as const`)
   + `ShipmentDirection`; export from the shipping barrel.
   - *Acceptance*: `pnpm type-check` clean; value array available for the DTO `@IsIn`.

### Phase 2 — Persistence shape
2. `shipment.orm-entity.ts` — `@Column({ type: 'text' }) direction!: ShipmentDirection;` with **no**
   `default`; change the `UQ_shipments_branch_one_per_order_conn` decorator to
   `['orderId', 'connectionId', 'direction']`, WHERE unchanged. Update the index's comment to say why
   `direction` is a key column and not a predicate arm.
3. `apps/api/src/migrations/1862000000000-add-shipment-direction.ts`:
   - `up()`: `ADD COLUMN "direction" text NOT NULL DEFAULT 'outbound'` → `ALTER COLUMN ... DROP DEFAULT` →
     `DROP INDEX "UQ_shipments_branch_one_per_order_conn"` → recreate with the three key columns.
   - `down()`: recreate the two-column index, drop the column. **Carries an inline comment**: recreating
     the two-column index fails with a duplicate key if any order ever holds both an outbound and a
     return branch-1 row. Unreachable today (nothing writes `'return'`), which is exactly why it must be
     written down — the first slice that buys a return label makes `down()` conditionally destructive.
   - *Acceptance*: `migration:show` lists it; the mechanical parity diff (§ 9) is clean.

### Phase 3 — Domain + repository
4. `shipment.entity.ts` — append `public readonly direction: ShipmentDirection` **last**, following the
   entity's stated anti-collision rule.
5. `shipment.types.ts` — `CreateShipmentInput.direction?: ShipmentDirection` (defaults to `'outbound'` in
   the repository builder, which is the one application-side default and is stated in the jsdoc).
6. `shipment-query.types.ts` — optional `ShipmentFilters.direction`, whose jsdoc carries the asymmetry
   justification (optional here, required on the three lookups) beside the existing `hasProviderShipmentId`
   note, which explains the same shape of decision.
7. `shipment-repository.port.ts` — required `direction` parameter on `findByOrderId`,
   `findActiveByOrderId`, `findBranchOneByOrderAndConnection`, each documented with why it is required
   (a default is a silent decline — the same reasoning that widened `SalesDocumentOrderFacts.buyerHasTaxId`
   to `boolean | undefined` rather than defaulting it), so a later reader does not "simplify" it back.
8. `shipment.repository.ts` — thread it into the three `where` clauses, `buildWhere`, `buildOrmEntity`
   and `toDomain`.

### Phase 4 — Call sites
9. `OrderFulfillmentProjectionService` → `findByOrderId(orderId, 'outbound')`.
10. `ShipmentDispatchService` → `'outbound'` at all three sites (two `findActiveByOrderId`, one
    `findBranchOneByOrderAndConnection`), with an inline note that return dispatch is a separate cohort.
11. `FulfillmentStatusSyncService` → `'outbound'`.
12. `ShipmentQueryService.getActiveForOrder` → `'outbound'`.
13. `ShipmentStatusSyncService` → `findMany({ connectionId, statuses, direction: 'outbound' })`.

### Phase 5 — API surface
14. `ShipmentResponseDto.direction` (+ `toResponse`), `ListShipmentsQueryDto.direction`
    (`@IsOptional() @IsIn(ShipmentDirectionValues)`), threaded into the controller's filter build.

### Phase 6 — Documentation
16. `docs/architecture-overview.md` § 22 Returns — the closing bullet currently asserts "**no
    `shipments.direction`** … carried forward rather than actioned". Correct it, and record the new index
    shape, what the `'outbound'` backfill asserts, and that nothing writes `'return'` yet.
17. `docs/architecture/adrs/060-returns-aggregate-above-source-projection.md` — one-line amendment note:
    actioned by #2373; the discriminator went in the index KEY, not its predicate.

### Phase 7 — Tests
18. Unit: repository builder default, `buildWhere` direction arm, entity mapping.
19. Integration (`apps/api/test/integration/shipping/`):
    - **D8 regression**: an outbound and a return branch-1 shipment coexist for one `(order, connection)`.
    - the outbound duplicate guard still refuses a second outbound branch-1 row.
    - a return duplicate is likewise refused.
    - each of the four predicates does not return the return row.
    - the column carries **no default** in the live schema (`information_schema.columns.column_default IS NULL`).

    **What that last assertion does and does not prove.** The harness builds its schema with
    `synchronize`, not with migrations (`docs/testing-guide.md` § Testcontainers Lifecycle, step 1), so it
    proves the ORM ENTITY declares no default and says nothing about the migration. The migration half is
    covered only by § 9's mechanical diff. The two are complements, not duplicates — do not delete either
    believing it repeats the other.

---

## 7. Alternatives Considered

- **`direction` in the index WHERE clause.** Rejected: leaves return rows unguarded (see § 4).
- **A separate `return_shipments` table.** Rejected: a return label is a shipment — same carrier, same
  waybill, same tracking poll — and duplicating the table would duplicate every predicate, every status
  machine and the `waybillRelayedAt` claim discipline.
- **Defaulting `direction` to `'outbound'` in the three read predicates.** Rejected: silent decline.
- **Hard-filtering `findMany` to outbound.** Rejected: makes return labels invisible on `/shipments`.

---

## 8. Validation & Risks

- **Risk — the recreated index is looser than the original.** Mitigated by the coexistence *and* both
  duplicate-refusal integration tests, and by the mechanical schema diff.
- **Risk — migration/entity drift.** The integration harness builds its schema with `synchronize`, so a
  migration that disagrees with the entity is invisible to every test. Mitigated by § 9.
- **Risk — a positional `Shipment` construction site missed.** Mitigated by the required trailing
  parameter (compile error) — the entity's own convention.
- **Backward compatibility**: additive column; every existing row reads `'outbound'`; every existing read
  path is explicitly pinned to `'outbound'`, so behaviour is byte-identical to today.

---

## 9. Mechanical migration/entity parity check (required)

Not optional on an index-changing slice. Procedure:

1. Boot a scratch Postgres, run `up()`'s DDL against a `shipments` table built from the PRE-change entity.
2. Boot a second scratch database and let TypeORM `synchronize` build `shipments` from the POST-change entity.
3. Dump `information_schema.columns` (name, type, nullable, default) and `pg_indexes.indexdef` for
   `shipments` from both, and `diff` them.
4. The diff must be empty — in particular `column_default` must be NULL on both sides, and the two
   `UQ_shipments_branch_one_per_order_conn` definitions must name the same three columns and the same
   predicate.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (domain types → ORM entity → repository; no port/adapter touched)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (`as const` union, partial unique index, append-last entity field)
- [x] Idempotency considered (migration is guarded/reversible; no new job)
- [x] Error handling unchanged (no new failure modes)
- [x] Testing strategy complete (unit + the D8 regression + live-schema assertions)
- [x] Naming conventions followed
- [x] Plan is execution-ready
