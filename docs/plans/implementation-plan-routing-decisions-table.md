# Implementation Plan: `routing_decisions` intent table + live partial-unique index

**Date**: 2026-08-30
**Status**: Ready for Review
**Issue**: #2394 (`W3a-5`, Wave 3a stream S1, size M) — epic #2412
**Branch**: `2394-routing-decisions-table` (based on `origin/oms-programme-wave-3a`)
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: persist the routing **intent** — the record that OpenLinker is about to ask a
router to decide where an order is fulfilled from — *before* the committing `route()` call, and
make "at most one live decision per order" a database fact rather than a hope.

**Context**: REVIEW C2, the review's highest-confidence finding class — **persisted evidence must
land before the boundary it protects**. A lock alone cannot supply that ordering: a lock is lost
on process death, a TTL expiry or a Redis blip, and the peer that acquires it next has no way to
learn that a `route()` call is already in flight. The shipped #2047 invoicing guard gets this
right and is the shape being copied. Two routers producing two plans for one order is a
**double-ship**: a physical, unrecoverable event.

**Classification**: CORE / Infrastructure (persistence) + a small domain vocabulary addition.

---

## 2. Scope & Non-Goals

### In scope

- `routing_decisions` table + migration `1865000000000`.
- `RoutingDecisionOrmEntity` registered on `FulfillmentModule`'s `forFeature`.
- The **live partial-unique index** `UQ_routing_decisions_live_order`.
- `RoutingDecisionRepositoryPort` + `RoutingDecisionRepository` (`claimIntent`, `terminalise`,
  `findLiveByOrderId`, `findById`).
- The domain vocabulary: `RoutingDecisionState`, `RoutingDecisionAbandonReason`, the
  `RoutingDecision` entity, `RoutingDecisionAlreadyLiveError`.
- The pure `deriveRouteIdempotencyKey`.
- Extension of `fulfillment-work-migration-parity.int-spec.ts` to cover the new table.

### Out of scope (named, with owner)

| Deferred | Owner |
|---|---|
| `selectPrimaryFulfillmentRouter`, the four-part gate, the per-order lock, the one-transaction commit | #2395 (`W3a-6`) |
| Any caller of `claimIntent` / `terminalise` — nothing consumes this slice | #2395 |
| The `fulfillment.work.route` job type | #2395 |
| Ingestion intercept (`none` / `ambiguous` / `selected`) | #2396 |
| Consuming `PendingRoutingPlan` (the `pending` arm) | `W4-3` |
| Any UI | #2410 / #2411 |

### Constraints

- **No `synchronize: true`.** Migrations are the source of truth.
- **ADR-053 no-injection invariant**: this context injects no `orders` / `inventory` service.
- **The `fulfillment` leaf's allow-set stays at two entries.** Every column here is a primitive
  or a union declared in this leaf, so no third `authorizedTypeOnlySpecifiers` entry is needed.
  Adding one would be a deliberate decision to justify, not a free ride.
- **`*RepositoryPort` is not exported from the context barrel** — `check-cross-context-imports`
  denies it as an intra-context contract. Only the input/output shapes and the token are exported.

---

## 3. Architecture Mapping

**Target layer**: CORE domain (vocabulary + entity + port) and CORE infrastructure (ORM entity,
repository, migration).

**Core vs Integration**: the decision row is OpenLinker's own record of its own act. It crosses no
port and belongs to no platform; a plugin router never sees it. It cannot live in `libs/oms`,
which is one implementer among several.

**Existing components reused**: `FulfillmentModule` (entity registration + provider binding),
`fulfillment.tokens.ts`, the `FulfillmentWorkTransaction` opaque transaction handle, the
`FulfillmentPersistenceError` wrapping discipline, and the migration-parity int-spec.

---

## 4. Design

### 4.1 The decision row, and why it is not the router's `decisionId`

`ResolvedRoutingPlan.decisionId` and `PendingRoutingPlan.decisionId` (#2393) are minted **by the
router**. This table's `id` is OpenLinker's own, minted **before** `route()` is called — so the two
identifiers cannot be the same value, and conflating them would make the audit trail read as
though the vendor authored OpenLinker's intent.

They are therefore separate columns: `id` (ours, the PK, the idempotency-key source) and
`routerDecisionRef` (theirs, nullable, recorded at terminalisation). A `null`
`routerDecisionRef` on a `committed` row is a real state and means the router answered without
naming a decision of its own.

### 4.2 Columns

| Column | Type | Null | Writer | Notes |
|---|---|---|---|---|
| `id` | `text` | no | `claimIntent` (insert-only) | `ol_routingdecision_*` |
| `orderId` | `text` | no | `claimIntent` (insert-only) | by-value, no FK |
| `routerConnectionId` | `uuid` | no | `claimIntent` (insert-only) | by-value, no FK |
| `state` | `varchar(32)` | no | `terminalise` | default `'live'`; never accepted at create |
| `routerDecisionRef` | `text` | yes | `terminalise` | the router's own id |
| `abandonReason` | `varchar(64)` | yes | `terminalise` | closed union; `null` on `committed` |
| `terminalisedAt` | `timestamptz` | yes | `terminalise` | |
| `createdAt` / `updatedAt` | `timestamptz` | no | ORM | |

**Writer discipline** (#2392's theme): the four `terminalise`-owned columns are **excluded from
`toOrm`** and are not settable at create — `claimIntent` builds the row with `state = 'live'`
implicitly and the other three `null`. There is no `save(decision)`. A row is inserted once and
mutated exactly once, by one narrow conditional UPDATE.

**`abandonReason` ships as a COLUMN; its union declares only what is already grounded.**
A terminal `abandoned` row with no reason is unactionable — the silent decline this repository
forbids by name (ADR-041 §54) — and #2100 is the precedent for shipping reason vocabulary ahead of
its writer (`'missing-required-tax-id'` / `'tax-rate-conflict'` ship declared and never written).
So the column lands now, avoiding a second migration one issue later.

The union, however, declares only values that correspond to **shipped code**:
`'plan-pending'` (#2393's `PendingRoutingPlanNotSupportedError`) and `'plan-not-conserving'`
(#2393's `checkRoutingPlanConservesQuantities`). Candidates like `route-threw` and `lock-lost` are
guesses about #2395's internals and are deliberately NOT declared — the column is `varchar(64)`, so
#2395 adds its own members with no migration. The read guard coerces an unrecognised value to
`null` (the #2100 rule), so a value written by a newer build is read as absent rather than
crashing an older one.

### 4.3 The index, and exactly why it is that wide

```sql
CREATE UNIQUE INDEX "UQ_routing_decisions_live_order"
  ON "routing_decisions" ("orderId")
  WHERE "state" = 'live';
```

- **Not `(orderId)` unconditional** — that forbids any second decision for an order, ever, which
  would break the legitimate re-route DESIGN §5.4 requires (`short_picked` + `releaseShortfall`
  re-enters `route()` with the rejecter blocked).
- **Not `(orderId, routerConnectionId)`** — that permits two routers to hold two live decisions
  for one order, which is precisely the double-ship #2395's guard must refuse "**regardless of
  router identity**".
- **Predicate is `state = 'live'` only** — a terminal row must leave the index so a fresh decision
  can claim.

**The index is necessary, not sufficient — and #2395 must not assume otherwise.**
It enforces "at most one live DECISION per order". DESIGN §5.3 requires refusing when a live
decision **or non-cancelled work** exists. Those are different sets: a `committed` decision with
live work leaves the index free, so a second `claimIntent` succeeds — which is correct, because the
`short_picked` re-route needs exactly that. The work-existence half of the guard is **#2395's**, and
nothing in this slice refuses it. Stated here so the guard is not built believing the database
already covers it.

**On the mutable-predicate tension.** `shipments.orm-entity.ts` carries an explicit warning
against putting a mutable column in a partial-index predicate (rows enter and leave the index on
ordinary updates) and keys on the monotone `providerShipmentId IS NULL` marker instead. That
warning does not govern here: rows *leaving* the index on terminalisation is the mechanism, not a
side effect. The governing precedents are `UQ_order_changes_open_target`
(`WHERE "status" IN ('pending','requested')`) and `UQ_reservations_active_line`
(`WHERE "status" = 'held'`), both of which key uniqueness on an open-state predicate exactly as
this does. Stated in the entity docblock so the next reader does not "fix" it toward the shipments
shape.

A second, **unconditional** `IDX_routing_decisions_order` on `("orderId", "createdAt")` — mirroring
`IDX_order_changes_order`, since a history read is ordered — serves the history read
(every decision for an order, whatever its state) — the partial index cannot, for the same reason
`IDX_fulfillment_holds_work` sits beside its partial sibling.

### 4.4 The idempotency key is derived, never stored

```ts
export const deriveRouteIdempotencyKey = (decisionId: string): string => `route:${decisionId}`;
```

Pure, in the leaf, beside the routing types. The row's `id` is immutable, so a **retry** of a
crashed route re-derives a byte-identical key (issue AC 3), while a **re-route** is a new row with
a new id and therefore a new key — which is correct, because a genuinely new decision must not
dedup against the previous one. This is the #2039 `reconcileId` lesson: a retrying or resuming job
is a different job, so the key must never come from the job id.

Not stored, deliberately, and the reason is structural rather than merely tidy: a stored column
can be written with a value that is **not** the derivation, whereas derive-only makes "the key is a
function of the row" true by construction instead of by convention.

*Reversal condition*: if a router ever echoes a key back, or an operator needs to correlate against
a vendor's own log, persist it then — an additive nullable column, cheap later, so there is no cost
to deferring it now.

### 4.5 Unique-violation handling

`claimIntent` matches **SQLSTATE `23505` AND the constraint name**, not the code alone — the
stricter `FulfillmentWorkRepository.isUniqueViolationOn` variant, because this table carries more
than one unique constraint (the PK and the live index) and a blanket catch would "report an error
naming a row that is fine, about a table that did not fail". A hit raises
`RoutingDecisionAlreadyLiveError` carrying the `orderId`; anything else is wrapped in
`FulfillmentPersistenceError`.

**It throws rather than re-selecting.** The `exchange_rates` `insertIfAbsent` shape recovers by
re-selecting the winner because the caller wants *a* rate; here the caller must **not** proceed —
a live decision existing is the refusal — so returning the winner would invite a caller to route
against someone else's intent. The error carries the order id **only** — enriching it with the incumbent's `routerConnectionId`
would cost a second query on the refusal path, and `findLiveByOrderId` is already on the port for a
caller that wants to name the holder.

### 4.6 Transaction placement — the sharp point

`terminalise` takes the optional opaque `FulfillmentWorkTransaction` handle; **`claimIntent` does
not, and must not.** The whole design is that intent is persisted and *committed* before the
boundary is crossed; enrolling the claim in the caller's transaction would let it roll back
together with the work rows, which is the ordering the lock could not supply and this table
exists to supply. `terminalise` is the participant in #2395's one-transaction commit (ADR-054 R1:
N work rows + terminalisation together).

**The default is already safe, which is worth stating so nobody "fixes" it.** A TypeORM repository
uses the default entity manager, not any ambient transaction the caller opened — so `claimIntent`
commits independently even if #2395 later wraps its work creation in `dataSource.transaction(...)`.
That is exactly the behaviour the design needs; threading the manager through would break it.

### 4.7 FK decisions

- `orderId → order_records`: **no FK**. Cross-aggregate by value (`order_changes` /
  `refund_records` / `returns.internalOrderId` precedent), and an intent record must survive the
  thing it decided about — the issue's "intent table" framing.
- `routerConnectionId → connections`: **no FK**. A deleted connection must not erase the audit of
  what it decided; same reasoning as `fulfillment_works.assignedConnectionId`.
- No child table, so no part-of-parent CASCADE FK exists in this slice.

---

## 5. Implementation Steps

### Phase 1 — Domain vocabulary

1. `domain/types/routing-decision.types.ts` — `RoutingDecisionStateValues` (`live` / `committed` /
   `abandoned`) + `isRoutingDecisionState`; `RoutingDecisionAbandonReasonValues` +
   `isRoutingDecisionAbandonReason`; `deriveRouteIdempotencyKey`. `as const` + union per
   engineering standards; the pure-rule exception covers the derivation living beside its type.
   *Acceptance*: unit spec asserts totality and key format.
2. `domain/entities/routing-decision.entity.ts` — readonly entity, anemic per ADR-011.
3. `domain/exceptions/routing-decision-already-live.error.ts`.
4. `domain/ports/routing-decision-repository.port.ts` — framework-free; input objects, not
   positional args, so `expectedState` can be added additively.

### Phase 2 — Persistence

5. `infrastructure/persistence/entities/routing-decision.orm-entity.ts` — named `@PrimaryColumn`
   constraint (`PK_routing_decisions`), both `@Index` decorators named to match the migration.
6. `infrastructure/persistence/repositories/routing-decision.repository.ts` — local
   `formatRoutingDecisionId`, the code+constraint-name violation matcher, `terminalise` as a
   conditional UPDATE returning `(result.affected ?? 0) > 0`.
7. `fulfillment.tokens.ts` — `ROUTING_DECISION_REPOSITORY_TOKEN`.
8. `fulfillment.module.ts` — add the entity to `forFeature`, the repository to `providers`, the
   token to `exports`. **Load-bearing**: the harness builds schema by `autoLoadEntities` +
   `synchronize` with no entity list, so a table reaches the test database only by riding a
   `forFeature` of a transitively-imported module.
9. `index.ts` — export the types, the entity, the error and the token. **Not** the repository port.

### Phase 3 — Migration

10. `apps/api/src/migrations/1865000000000-create-routing-decisions.ts`, class
    `CreateRoutingDecisions1865000000000`, `name` property matching. Copies #2392's structure:
    `CREATE TABLE IF NOT EXISTS` with the inline named PK, indexes issued separately with the
    partial `WHERE` on its own line, `down()` dropping indexes in reverse then the table.
    **No `CREATE EXTENSION "uuid-ossp"`** — #2392 needs it because its line and hold PKs default to
    `uuid_generate_v4()`; this table's PK is `text` minted in code and no column takes a uuid
    default, so copying that statement would propagate the #2684 workaround to a migration that
    does not need it.
    *Acceptance*: `migration:show` reports 0 pending; the chain runs from an empty database.

### Phase 4 — Tests

11. Unit: types totality, key derivation, id-format drift (asserts the local mint agrees with
    `formatInternalId`'s format without value-importing it — #2392's pattern), repository spec.
12. Int (schema): columns, both indexes, defaults.
13. Int (concurrency): **two concurrent claims for one order leave exactly one live row**, one
    fulfilled + one `RoutingDecisionAlreadyLiveError`, `count(*) WHERE state='live' = 1`.
14. Int (lifecycle): terminalise → a fresh claim for the same order **succeeds** (re-route);
    terminalise twice returns `false` the second time.
15. Extend `fulfillment-work-migration-parity.int-spec.ts`'s `TABLES` with `routing_decisions`.
    One line; the spec already runs the full chain, so the fourth table is free.

---

## 6. Red-first evidence protocol

Each guard is proved by making it fail **for the right reason** first — a `TS6133` unused-import
red with `Tests: 0 total` is a false pass, and a red caused by the container refusing to boot
proves nothing about the assertions.

| Guard | How it is made to fail | The red that counts |
|---|---|---|
| Live partial-unique index | drop the index in the running test DB, re-run | both claims succeed; `live` count is 2 |
| Predicate is `live`-only | temporarily widen to no predicate | the re-route test fails on the second claim |
| Constraint-name match | broaden the catch to bare `23505` | a PK-violation fixture reports "already live" |
| Parity | rename the index in the entity only | the parity spec's `indexdef` diff fails |

The concurrency test must be able to distinguish the defect from its absence (#2392's first
attempt passed with the lock removed): both claims are issued on **separate query runners** and
awaited with `Promise.allSettled`, and the assertion is over the persisted row count, not over
which promise rejected.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Migration diverges from the entity | the parity spec, extended in this slice |
| Predicate too wide/narrow | §4.3 states both failure modes; the re-route int-spec covers "too wide" |
| `uuid-ossp` (#2684) blocks a from-empty run | the parity spec's existing workaround; this table's PK is `text`, minted in code, so it needs no uuid default at all |
| Someone "fixes" the mutable predicate toward the shipments shape | the entity docblock states why that warning does not govern here |

---

## 8. Alternatives considered

1. **A `liveDecisionId` column on `order_records`.** Rejected: `order_records` is already a
   multi-writer table whose `toOrm` exclusions exist to stop exactly this, it creates a
   `fulfillment → orders` write edge ADR-053 forbids, and a nullable column cannot express the
   decision's history.
2. **A lock alone, no table.** Rejected — this is the finding (REVIEW C2). A lock is lost on
   process death or TTL expiry and leaves no evidence a peer can read.
3. **Persist the idempotency key as a column.** See §4.4.
4. **A new ADR.** Not written: ADR-054's R1 amendments already specify this row, its partial-unique
   index and the derived key by name. This plan implements a recorded decision rather than taking
   a new one.

---

## 9. Acceptance criteria (from #2394)

- [ ] `migration:show` reports no pending migrations; no `synchronize: true` introduced
- [ ] Two concurrent claims for one order leave exactly one live row (int-spec, real Postgres)
- [ ] A retry after a crashed route re-derives an identical idempotency key
- [ ] Repository throws a domain error on unique violation
- [ ] Tests added for non-trivial logic
- [ ] No architecture boundary violations (leaf allow-set unchanged at two entries)

---

## 10. Alignment checklist

- [x] Hexagonal layering (domain vocabulary → port → infrastructure)
- [x] CORE ↔ Integration boundary untouched; no adapter, no capability
- [x] Reuses #2392's shapes rather than inventing new ones
- [x] Idempotency considered (§4.4)
- [x] Error handling: domain error at the boundary, code+name match
- [x] Testing strategy complete, with red-first evidence per guard
- [x] Naming + file structure per `engineering-standards.md`
