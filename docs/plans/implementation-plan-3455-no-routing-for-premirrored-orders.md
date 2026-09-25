# Implementation Plan — #3455: an order mirrored before routing was switched on is not routed on re-ingest

Epic #3460. Stacked on #3487 (#3490) → #3488 (#3496).

## 1. Understand

**Goal.** With the OMS on, an order the product master already received (a
`synced` destination `syncStatus` row written before routing was switched on)
must not be routed to the pack bench when it is ingested again. Otherwise one
parcel can be packed twice and, with #3453, its stock lowered twice. The skip
reason must be persisted and visible on the order.

**Layer.** CORE (orders, application + persistence) + Interface (order DTO).

**Decided with the operator (this session).** The reason is ONE field for every
"OpenLinker deliberately did not route this order" answer, not a column per
issue: `order_records.fulfillmentRoutingSkipReason`, values
`own-shop-order` (#3487), `shipped-by-other-system` (#3488),
`mirrored-before-routing` (#3455). One question the operator asks ("why is this
order not on the pack bench?"), one answer.

**Non-goals.**
- Frontend rendering (#3482 consumes the field).
- A guard inside `RoutingCommitService`: the `fulfillment` leaf may not read
  `orders` (ADR-053), and `fulfillment.work.route` has no production producer.
- Re-using `fulfillmentBlockReason` — that column means "held, waiting"; a
  skipped order is not held, it follows today's path.
- #3014's `destinationRoutingBlockReason` answers a different question (which
  destinations a router decision narrowed to) and stays separate.

## 2. Research

- `OrderIngestionService.syncOrderFromSource` reads `existing` (pre-persist
  `OrderRecord`) at the top; `persistOrder` never writes `syncStatus` (#2140), so
  `existing.syncStatus` is current. The #2588 `alreadyProvisioned` check already
  uses exactly `row.status === 'synced'`.
- `interceptFulfillmentRouting` already has the #3487 / #3488 skip arms before
  router selection; its outcome is persisted by `persistFulfillmentOutcome` →
  `markFulfillmentBlock` (level-triggered, `IS DISTINCT FROM` guard).
- Persistence pattern to copy: `fulfillmentBlockReason` (migration
  `1869000000400`, ORM `text` column, sole-writer `updateFulfillmentBlock`,
  excluded from `toOrm`). Domain-entity + DTO pattern: `salesDocumentBlockReason`
  (coerced through a guard in `toDomain`, appended LAST to the positional
  constructor).

## 3. Design

- **Vocabulary** in `orders/domain/types/fulfillment-routing-eligibility.types.ts`:
  `FulfillmentRoutingSkipReasonValues`, `FulfillmentRoutingSkipReason`,
  `isFulfillmentRoutingSkipReason`, plus the pure rule
  `isOrderMirroredBeforeRouting(syncStatus)` (any row `synced`).
- **Recorded only when the OMS is on.** The #3487 check runs before selection,
  so without a gate every shop order on an OMS-off install would be labelled
  "pack it in your shop". The skip reason is written only when router selection
  found a claimant (`reason !== 'no-claimant'`); otherwise `null`.
- **Precedence** (first match wins, cheapest first): own shop → mirrored before
  routing → shipped by another system (the last needs the memoized routing
  resolve).
- **Outcome shape.** `FulfillmentInterceptOutcome` gains
  `skip: { kind: 'skipped'; reason } | { kind: 'none' } | { kind: 'indeterminate' }`
  — `indeterminate` (the fail-open catch) leaves the stored value untouched,
  the #2100 rule.
- **Write.** `IOrderRecordService.markFulfillmentRoutingSkip` →
  `OrderRecordRepositoryPort.updateFulfillmentRoutingSkipReason`, one guarded
  `UPDATE … WHERE … IS DISTINCT FROM`, so the common `null → null` path costs no
  `updatedAt` bump. Best-effort, never fails ingestion.
- **Read.** `OrderRecord.fulfillmentRoutingSkipReason` (appended last), coerced
  in `toDomain`; exposed on `OrderRecordResponseDto`.

## 4. Steps

1. `fulfillment-routing-eligibility.types.ts` (+ spec) — vocabulary, guard,
   `isOrderMirroredBeforeRouting`.
2. Migration `apps/api/src/migrations/1904000000000-add-order-fulfillment-routing-skip-reason.ts`
   — nullable `text`, no index.
3. ORM entity column; domain entity field (last constructor param).
4. Repository: `toDomain` coercion, `toOrm` exclusion note,
   `updateFulfillmentRoutingSkipReason`; port method.
5. Service interface + `OrderRecordService.markFulfillmentRoutingSkip`.
6. `OrderIngestionService`: compute `alreadyMirrored` from `existing`, pass into
   the intercept; restructure the intercept (selection first, skip arms, outcome
   `skip`), persist via `persistFulfillmentOutcome`.
7. `OrderRecordResponseDto` + controller mapping.
8. Specs: eligibility types, ingestion (three reasons persisted with OMS on;
   none with OMS off; `null` when routed; untouched on intercept failure;
   pre-mirrored order not routed, not decremented; new order still routed).
9. `docs/architecture-overview.md` — #3455 bullet; amend #3487/#3488 bullets.

## 5. Validate

- Hexagonal: domain rule is pure; persistence stays in the repository; no new
  cross-context edge (`fulfillment` leaf untouched).
- Migration required (ORM entity change) — `migration:show` cannot run without a
  DB here; number chosen above `origin/main` max (`1899…`) and above the stack's
  `1893…`.
- Quality gate: core type-check, lint on changed files, `check:invariants`;
  tests run on CI.
- `/pre-implement` skipped: the only new identifiers (`fulfillmentRoutingSkipReason`,
  `markFulfillmentRoutingSkip`, `updateFulfillmentRoutingSkipReason`,
  `FulfillmentRoutingSkipReason`) were grepped and do not exist anywhere in the tree.
