# Implementation Plan — #1032 OMS module

**Parent issue:** #1032 (reopened 2026-08-13)
**Spec:** [`docs/specs/product-spec-1032-order-status-state-machine.md`](../specs/product-spec-1032-order-status-state-machine.md)
**Readiness gate:** [`analysis/ANALYSIS-implementation-plan-1032-oms-module.md`](./analysis/ANALYSIS-implementation-plan-1032-oms-module.md)
**Status:** plan of record. Waves are separately gated — see § 8 Checkpoint.

> Supersedes the scoping in #2064 (closed as duplicate of #1032).
> [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) and
> [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) must move from
> `Proposed` to `Accepted` **before** any Wave 0 code merges.

---

## 1. Framing

OpenLinker holds most of an OMS's *data* and none of its *stance*. This program adds the stance:
an OL-owned order lifecycle, the operator workbench that expresses it, and the orchestration that
acts on it.

**Archetype:** operator workbench on an orchestration spine. Not a channel-protocol relay, not an
OMS of record.

**The organising principle:**

> OpenLinker is never the executor. It does not create orders — it ingests them. It does not move
> money. It does not physically ship. Every mutation it performs is a **proposal against a remote
> authority that may decline it**, plus an **observation** of what that authority did.

**And a sharper constraint, with a schema behind it:** OpenLinker **cannot change an order's
composition.** The marketplace owns order identity, and `identifier_mappings` enforces that as a
**bijection per connection** — one external id ↔ one internal id. Split needs 1→N, merge needs N→1;
both indexes are load-bearing. OL can only *observe* composition and *attribute work* to it. See § 6J.

| Instead of | Do this | Because |
|---|---|---|
| a stored order-status field | a derived projection over recorded facts | three systems report status; none can own it |
| mutating the order | a proposal record: proposed → confirmed/declined | the remote may decline; a refusal must be a first-class outcome, not a swallowed error |
| a status enum per line | quantity counters | "3 of 5 shipped" is not a status |
| one lifecycle enum | independent nullable timestamps | a carrier can report *delivered* before OL saw *shipped* |

**Permanent non-goals** (ADR-014, spec §6.1): payment capture/settlement, accounting/GL, warehouse
mechanics (bins, putaway, cycle counts, slotting), customer master beyond projections.

---

## 2. Settled decisions

| # | Decision | Basis |
|---|---|---|
| D1 | Canonical status is a **derived projection over a fact ledger**, never a stored contested scalar | spec Phase C adversarial review; Vendure's non-monotone `Shipped→PartiallyDelivered` edge is the cost of the alternative; Saleor's recompute is incidentally robust to late events |
| D2 | **Per-line quantity counters** carry fulfilment/return progress; `partially_*` always derived | Medusa `order_item.*_quantity` + its validation ladder |
| D2a | Counters are a projection over an append-only event ledger, **never free-floating** | Bagisto ships these counters without a ledger and has documented drift |
| D3 | **Do not embed Medusa** — steal the model | spike: boots standalone, but 605 packages, a second ORM, a second DI container, and an unresolved Enterprise-Edition carve-out on the mandatory `framework`/`utils`/`types` tier |
| D4 | Rules engine = hand-rolled **versioned condition AST** + the existing `sync_jobs` scheduler | capability-gating and durable delay are ours regardless |
| D5 | **Dry-run is the differentiator**, and nearly free | preview and apply are one replay function. Requires purity: no I/O during evaluation |
| D6 | Returns is a **child aggregate**, not an axis | axis rows are one per order×axis; returns are N per order |
| D7 | Reservations get their **own table**; never overload `inventory_items.reservedQuantity` | that column is a master mirror, rewritten on every sync |
| D8 | Invoice issuance is an **observed** event keyed on the KSeF-returned date | art. 106na — the legal issue date is assigned at transmission |
| D9 | **Invert Medusa's concurrency model**: an atomic conditional UPDATE + CHECK constraint against an **OL-owned counter column** (`olReservedQuantity`), never the master mirror — see § 6I | Medusa has zero `FOR UPDATE`, zero CHECK constraints, read-then-write LWW; no surveyed OSS platform does better |
| D10 | Lifecycle facts as **independent nullable timestamps**, not one enum | a single flag cannot carry both "did it happen" and "did we relay it" (#1947) |
| **D11** | **`totalAvailable` keeps its current meaning (raw available). ATP is a NEW field.** | Redefining it is a silent semantic break across 6 consumers with zero compile errors — see § 6 C2 |
| **D12** | **Backend authorization is `@Roles(...)`, not permissions.** Permissions drive UI visibility only | `frontend-architecture.md` § Access Control; `role.types.ts` doc comment — see § 5F |

---

## 3. The core abstraction: the proposal record

**Narrowed after a stress test — see § 6J.** A change is
`PENDING | REQUESTED → CONFIRMED | DECLINED | CANCELED`, carrying `requested_by` / `confirmed_by` /
`declined_reason`, timestamps, and an `applied` boolean, with a **partial unique index** enforcing one
open change per order (OL runs concurrent workers, so an application guard would be a race).

`applied` becomes the single at-most-once primitive, replacing the three hand-rolled claims
(`waybillRelayedAt`, `isFirstDispatchTransition`, `cancelledAt` COALESCE).

**Deferred:** the actions table, the action registry, and the replay function. Every mutation OL can
actually perform is a **single action against a single reference**; `ordering`, replay and a
polymorphic reference pair serve compositions that do not exist here. Revisit if partial cancellation
turns out to be supported by Allegro or Erli — that would be the first genuine composition.

**Dry-run moved out of this decision.** It belongs to the rules engine's condition evaluation (D4/D5),
which delivers it independently.

See [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md).

---

## 4. Placement, naming and schema conventions

Binding on every wave. Derived from the readiness gate.

- **Service naming.** The coordinating writer is **`OrderAxisLedgerService`** — *not*
  `OrderLifecycleService`, which is one word from the existing `OrderLifecycleRelayService` in the
  same folder. It implements `IOrderAxisLedgerService` in a sibling `*.service.interface.ts`
  (required by `check-service-interfaces.mjs`) and binds via `ORDER_AXIS_LEDGER_SERVICE_TOKEN` in
  `orders.tokens.ts`.
- **Repository ports stay intra-context.** `OrderAxisLedgerRepositoryPort` must **not** be exported
  from `libs/core/src/orders/index.ts` — `*RepositoryPort` is a denied cross-context symbol shape.
- **ORM entities go on the sub-barrel.** New axis-ledger / pack / stage ORM entities are exported
  from `libs/core/src/orders/orm-entities.ts`, never the main barrel (`index.ts:175-177` documents
  the split).
- **Entity changes are append-only.** `OrderRecord` has 14 positional constructor params across 33
  call sites. Append new fields with `= null` defaults (breaks 0 sites) — or better, add a derived
  **getter**, matching the six snapshot-derived getters the entity already carries.
- **Migrations.** Synthetic sequential prefixes only, strictly greater than the current tail
  (`1833000000000`, so start at `1833000000001`); class-name suffix must repeat the filename prefix;
  hand-author DDL for partial indexes. `migration:generate` emits a real epoch prefix that sorts into
  the middle of history — **re-prefix before committing**. Ordering vs `origin/main` is a hard CI
  failure (`docs/migrations.md` rule 3).
- **New event stream** requires a stream constant, a DLQ constant, a **MAXLEN entry** in
  `redis-streams-event-publisher.ts`, module wiring, and a **dedicated blocking Redis client** — two
  `XREADGROUP` loops cannot share a connection.
- **New job types** need a `JobTypeValues` literal, a handler, registration in
  `handler-registration.service.ts` + `sync-worker.module.ts`. `SyncJobRequest.connectionId` is
  non-nullable (#1943), so a pack job with no natural connection needs a scaffold connection, as
  `destination.taxonomy.sync` already does.

---

## 5. Waves

### Wave 0 — Lifecycle foundation (no user-visible change)

Justified independently of the strategic bet: replaces three ad-hoc at-most-once claims with one
primitive and closes a documented lost-cancel bug (a cancel arriving before the order's create job
runs finds no targets and is silently lost — `order-ingestion.service.ts`).

1. `order-lifecycle-state.types.ts` — axes, ordinals, canonical states, documented precedence
2. `derive-canonical-lifecycle.ts` — pure projection, sibling of `order-sla.ts`; **consumes**
   `deriveSlaState` and `deriveFulfillmentRollup` rather than re-deriving them
3. Migration: `order_axis_states`, `order_axis_transitions`, `order_records.canonicalState`
4. `OrderAxisLedgerRepository` — conditional-claim + monotonic-UPDATE primitives
5. `OrderAxisLedgerService` — the sole coordinating writer
6. Re-route the three existing claim sites; delete `isFirst*Transition` **in the same commit**
   (they are today's only at-most-once guarantee; removing them early double-relays)

Idempotency key: `(internalOrderId, axis, originConnectionId, sourceEventId)`. Scoping by
`originConnectionId` is required — external event ids are only connection-unique, which is why
`webhook_deliveries` keys on `(provider, connection_id, event_id)`.

**API contract decision (W2).** `canonicalState` is **additive** on
`order-record-response.dto.ts`; `fulfillmentState` and `slaState` keep their current enum-typed
meaning and keep driving the list badge and filters. Deprecating them is explicitly **deferred** —
until then the FE treats `canonicalState` as the headline and the other two as contributing detail.

### Wave 1 — Event path + durable relay

7. `events.order.lifecycle` stream + `OrderLifecycleToJobHandler` (clone `MasterDeletionToJobHandler`)
8. **Ledger-as-outbox**: `order_axis_transitions.relayState` (`pending → done | unsupported | failed`)
   plus a `relaySweep`. Master-deletion's at-most-once is tolerable there because `isStale` stays
   authoritative and an hourly sweep re-reads it; an outbound obligation has no re-derivable backing
   state, so a lost event is a lost notification
9. ADR-028 amendment: cancellation → stock-restore becomes an event consumer
10. Exploit Allegro's `checkoutForm.revision` / 409 CONFLICT for safe status write-back

### Wave 2 — Operator workbench (see § 6)

### Wave 3 — Orchestration

11. Rules engine over **OL's own event surface** — parity on triggers you cannot emit is not parity
12. Delayed actions via `SyncJobsService.schedule({ runAfter })`; guards re-evaluated **at resume**
13. Dry-run + negative-evaluation logging (reuses the changeset replay)
14. SLA: the product is *managing the dispatch declaration as a risk position*, not showing a number

### Wave 4 — Post-sale

**Step 0 (blocking, do first).** Convert all five `OrderLifecycleEventType` consumers to exhaustive
handling with a `never` default — `order-lifecycle-relay.service.ts:122`, the Allegro and Erli order
sources, and the WooCommerce and PrestaShop processors — plus the two int-test stub helpers. All five
are today two-branch `if/else`, so extending the union **compiles cleanly and mis-routes at
runtime**; Erli would report a returned order as `sent`. See § 6 C1.

15. **`Return` as its own aggregate** — own id, own status enum, `orderId`, `externalReturnId` (so a
    marketplace-originated return round-trips), and transition timestamps. The status enum must carry
    **`declined`** and **`cancelled`**: a declined return leaves the order exactly as it was, and that
    has no order-status equivalent. Minimum set:
    `requested | approved | received | closed | declined | cancelled`
16. **`ReturnLine`** — points at the order line; carries `requestedQuantity`, **`receivedQuantity`**,
    **`damagedQuantity`**, `reasonCode`, `reasonNote`. Four independent systems converge on the
    quantity split (Medusa `received`/`damaged`; Shopify processable/processed/refundable/refunded;
    commercetools BackInStock vs Unusable) — no single field says "3 came back, 1 is scrap"
17. **Reason codes are their own vocabulary**, attached **per line**, not per return — the consensus
    across BaseLinker, Shopify and Saleor. Never reuse order-status codes
18. Extend `OrderLifecycleEventTypeValues` (only after Step 0)
19. Return → `CorrectionIssuer` mapper — the capability is already return-shaped
20. Restock — the real gap: nothing writes master inventory upward today. `damagedQuantity` is what
    decides whether stock goes back on the shelf
21. Disputes (a richer writable Allegro surface than returns)
22. **Refund intent ≠ refund execution** — a claimed amount on the return, the executed movement
    recorded where OL records money. Never one `refunded` boolean. BaseLinker states outright that its
    own `setOrderReturnRefund` "doesn't issue an actual money refund"; Medusa and Saleor split the
    same way

**Deliberately out of the minimum model** (all additive later, none forces a reshape): exchanges,
reverse-fulfilment logistics, restocking fees.

### Wave 5 — Allocation

21. `inventory_reservations` ledger + `inventory_items.olReservedQuantity` counter — see § 6I
22. **Add `availableToPromise` and `olReserved` to `VariantAvailability` (D11).** `totalAvailable`
    keeps meaning raw available. Name the new field **`olReserved`, not `reserved`** — the sibling
    `ProductStockAggregate.totalReserved` already means the *master mirror*, and two fields named
    `reserved` meaning different things on sibling types is a trap. Migrate the six consumers to ATP
    **explicitly, one at a time**
23. `applyStockSafetyBuffer` consumes ATP — see § 6 C3 for the accepted trade-off, the required doc
    updates, **and the feedback-loop hazard**
24. Atomic reserve (D9) against `olReservedQuantity` — exact DDL and SQL in § 6I
25. Reserve/release at three existing seams; expiry sweeper. **Release must be driven by the
    lifecycle event that also causes the master to decrement** (§ 6I), not an independent timer
26. Make `InventoryRepository.upsert`'s existing-row write **explicitly column-scoped** (§ 6I) — it
    is column-scoped today only as an emergent property of TypeORM's `save()` diffing, which is too
    thin a basis for an oversell guarantee
27. Remove `reserveInventory` / `releaseInventory` from `InventoryMasterPort`. Safe (structural
    excess is legal; zero non-spec call sites) but requires deleting two adapter specs and updating
    `docs/capabilities.md:29` + the `engineering-standards.md` port snippets **in the same PR**

---

## 6. Wave 2 in detail, and the three Critical corrections

### 6A. Operator stage pipeline

`order_stages` — operator-defined, seeded `New → To pack → Packed → Ready to ship → Shipped → Done`.
Columns: `name`, `ordinal`, `canonicalState` (**one-way** map onto the guarded core), `color`,
`isTerminal`, `isActive`. Placement: `order_records.stageId` + `stageEnteredAt`.
`order_stage_history` records (from, to, actor, at).

A stage is an *operator label*, never an axis — it does not feed the canonical derivation, or
operators could corrupt the guarded core. Moving to a stage is legal iff the implied canonical
transition is legal.

**Relationship to the existing `order_state_mapping` (W3).** That table is an **outbound translation
table**: per *destination* connection, canonical `OrderStatus` → the platform's native state id, with
its own CRUD UI. It is untouched. Stages map onto `canonicalState`, and `resolveOrderStateMapping`
continues to translate `OrderStatus` — stages are **never** an input to it. Two operator-facing
vocabularies now exist; the Mappings page must label its own as "destination order states" to keep
them distinct.

### 6B. Per-line counters

`order_record_items` — one row per order line. Identity: `internalOrderId`, `lineId`, `variantId`.
**Denormalised** `sku`, `ean`, `name` so a stale/deleted master variant (#1689) cannot make a
historical order unreadable. Counters: `packed_quantity`, `fulfilled_quantity`, `shipped_quantity`,
`delivered_quantity`, `return_requested_quantity`, `return_received_quantity`,
`written_off_quantity` — plain integers (no `raw_*` doubling; OL owns no money).

Validation ladder, each rung rejecting with an operator-readable message:
`packed ≤ ordered` · `shipped ≤ packed` (when the gate is on) or `≤ ordered` · `delivered ≤ shipped`.

Populated at ingestion from `orderSnapshot.items`; backfill required for open orders.
**D2a: counters are derived from `order_pack_events` and shipment facts — never free-floating.**

### 6C. Pack station

`order_pack_events` — append-only, the ledger behind `packed_quantity`. Columns: `orderId`,
`lineId`, `quantity`, `actorUserId`, `method` (`scan | manual`), `clientEventId` **UNIQUE**,
`createdAt`. The unique client id makes a double-scan idempotent — the real concurrency hazard at a
bench is one packer scanning twice, not two packers.

Barcode resolution uses `ProductVariant.ean`, already populated by the master sync. Four distinct
rejection reasons: barcode not on this order · line already fully packed · order not in a packable
stage · variant is stale.

Completion auto-advances to the configured packed stage. **Short-pack** is explicitly allowed with a
reason, recorded as an exception, and does *not* auto-advance — without it, one missing item seizes
the bench.

### 6D. Station authentication — highest-risk item

Two layers: a long-lived **device session** scoped to warehouse permissions and packable-stage orders
only, plus a **per-order actor** resolved by PIN or badge scan, stamped on each pack event.

Copy the `mcp_tokens` *pattern* (opaque prefix + SHA-256 at rest + revoke + `lastUsedAt`) into a
sibling table — **do not** extend MCP scopes; `McpTokenService` hardcodes its prefix, scope union and
RFC 8707 `resource`. Note `mcp_tokens.expiresAt` is **non-nullable by design**: a
"never expires" station token contradicts that invariant, so station tokens carry a finite expiry and
a renewal flow.

**This warrants its own ADR and a security review before implementation.**

### 6E. Dispatch gate

`connection.config.requirePackVerification` (JSONB, default `false`), matching the
`stockSafetyBuffer` / `pricingRule` precedent — no migration. Read via a pure
`readRequirePackVerification(config)` coercer. Enforced at label generation, naming the unpacked
lines. Later expressible as a rule.

### 6F. Authorization — corrected (D12)

**Permissions are display-only in this codebase.** `RolesGuard` is exact-role membership; there is no
permission-based guard, and `role.types.ts` documents that adding a permission does not open an
endpoint.

Therefore:

- **Extend the existing `operator` role** rather than adding a fourth. `operator` already holds
  `orders:write` and `shipments:write`; a new role means auditing every `@Roles('admin','operator')`
  list, pinned by `write-guard-coverage.spec.ts`.
- Every new pack/stage endpoint declares `@Roles('admin', 'operator')` **explicitly**, and the new
  permission strings (`pack:write`, `stage:write`) exist **only** to drive FE affordance visibility.
- The station device session is a separate principal (§ 6D) and is authorized by its own guard, not
  by the role ladder.

### 6G. Frontend

The station page is a **documented departure** from the responsive contract: `frontend-ui-style-guide.md`
§ Responsive makes complex editors read-only below 1024 px, but a pack bench is fully interactive at
tablet width — same shape of exception as the offer-picker modal (#1754/#1779), and recorded there.
Tap targets ≥ 44 px; scanner input is a keyboard-emulating device but assume nothing until tested.

It renders **outside `AppShell`**, as a top-level sibling of `consentRoute` with its own
`StationLayout` (the `/consent` precedent), and must satisfy `route-lazy.test.ts`.

### 6H. Sequencing — Wave 2 can precede Wave 0

6B + 6C have no hard dependency on the axis ledger; only the stage pipeline's `canonicalState`
mapping does, and stages can ship bound to `fulfillmentState` / `cancelledAt` and be re-bound later.

- **Fast path:** 6B → 6C → 6A → Wave 0/1 later. Visible value sooner; rework bounded to one column.
- **Foundation first:** Wave 0 → 1 → 2. Cleaner; nothing user-visible for longer.

Recommended: **fast path**.

### The three Critical corrections

**C1 — extending `OrderLifecycleEventTypeValues`.** Handled by Wave 4 Step 0 above.

**C2 — ATP must be a new field, not a redefinition (D11).** Changing `totalAvailable` to mean ATP
produces zero compile errors and no test failures while silently changing published marketplace
quantities (`bulk-listing-submit.service.ts:655`), the operator-facing "stock at risk" panel — which
surfaces that field **as `masterStock`** (`stock-at-risk-read.service.ts:84`) — and the
`get-availability` MCP tool. It would also contradict `offer-stock-restore.service.ts`'s own header
invariant.

**C3 — the buffer double-subtraction is accepted, and must be documented.** After Wave 5, published
stock is `master − olReserved − buffer`. This is *correct* — reservations cover known allocations,
the buffer covers unknown sync latency — but it is a behaviour change with no config change and no
log line. Required in the same PR: update the `stock-safety-buffer.types.ts` header and
`connection.types.ts:74` to say the input is ATP, and note in release notes that operators may want
to reduce their configured buffer. Also re-check the at-risk threshold in
`stock-at-risk-read.service.ts:90`, which will fire earlier.

**C3a — the feedback loop is the real hazard, and it is not the same as C3.** Because item 23 feeds
ATP into the published quantity, an OL reservation lowers what OL publishes. When that same order
later lands at the master and the master decrements its own stock, the next sync lowers
`availableQuantity` for the *same unit* — while the OL reservation is still `held`. The unit is
deducted **twice** from published stock until the reservation closes.

The mitigation is a hard requirement, not a nicety: a reservation's transition to `consumed` **must
be driven by the same lifecycle event that causes the master to decrement** (order committed /
fulfilled at source). The expiry sweeper is a safety net for abandoned reservations, never the
normal close path. Where that coupling cannot be guaranteed for a given source, reservations for
that source must be short-TTL only.

---

## 6I. Reservation mechanism — D7/D9 resolved

D9's original phrasing (`SET reserved = reserved + $1 WHERE stocked - reserved >= $1`) was
Medusa-shaped, borrowed from a schema where `reserved_quantity` is platform-owned. In OL it is not:
`master-inventory-sync.service.ts:306-317` writes `reservedQuantity` straight from the master every
sync. **The mechanism is right; the column was wrong.** Keep the guarded `UPDATE … RETURNING`, move
the counter to a column OL owns.

### Schema

```sql
ALTER TABLE "inventory_items"
  ADD COLUMN "olReservedQuantity" integer NOT NULL DEFAULT 0;
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "CHK_inventory_items_ol_reserved_nonneg" CHECK ("olReservedQuantity" >= 0);
```

Deliberately **no** `CHECK (olReservedQuantity <= availableQuantity)`. The master may legitimately
lower `availableQuantity` below an already-committed reservation set; such a constraint would make
the *sync* fail rather than surface a shortfall. That case is what the shortfall path exists for.

The `inventory_reservations` ledger carries `inventoryItemId` (FK, `ON DELETE RESTRICT` — a row with
live reservations must not vanish; the stale path soft-marks rather than deletes), `orderRecordId`,
`orderLineId`, `quantity`, `status` (`held | released | consumed`), `expiresAt`, timestamps, plus:

```sql
CREATE UNIQUE INDEX "UQ_inventory_reservations_active_line"
  ON "inventory_reservations" ("orderLineId") WHERE "status" = 'held';
```

That partial unique index **is** the idempotency key — a retried reserve fails the insert instead of
double-incrementing. Same idiom as the two partial unique indexes already on `inventory_items`.

### Reserve — both statements in one transaction, lines sorted by `inventoryItemId`

```sql
UPDATE "inventory_items"
   SET "olReservedQuantity" = "olReservedQuantity" + $2
 WHERE "id" = $1
   AND "isStale" = false
   AND "availableQuantity" - "olReservedQuantity" >= $2
RETURNING "availableQuantity" - "olReservedQuantity" AS remaining_atp;
```

Zero rows ⇒ insufficient ATP or a stale row ⇒ domain rejection, roll back the whole order's set.
Copy the unwrap idiom from `invoice-numbering-series.repository.ts:283-288` (`manager.query()`
returns `[rows, affected]` for a data-modifying statement with `RETURNING`).

**Sorting by `inventoryItemId` is mandatory**, not stylistic: two multi-line orders touching the same
variants in opposite order deadlock without it.

Release and consume decrement identically via a `WITH released AS (UPDATE … WHERE status='held' …)`
CTE, so a second release matches nothing and is idempotent. `GREATEST(0, …)` guards against a
reconciler having already corrected the counter; the CHECK is the hard floor.

### Master-sync race

Both writes take a row lock on the same `inventory_items` row, so they serialise. Sync-first: the
reserve's `WHERE` reads post-sync stock — correct. Reserve-first: the sync writes only
`availableQuantity`, `reservedQuantity`, `locationId`, `isStale`, `updatedAt`, so the reservation
survives; if the new availability is now below `olReservedQuantity`, ATP clamps to 0 and the gap is
the shortfall.

That safety currently holds **only as an emergent property** of TypeORM's `save()` diffing skipping
undefined properties. Item 26 makes it explicit: replace the `existing` branch of
`InventoryRepository.upsert` with a `createQueryBuilder().update().set({…})` naming exactly the five
master-owned columns.

### ATP read

In `findAvailabilityByVariantIds` (keep the `isStale = false` filter and the `GROUP BY`):

```sql
COALESCE(SUM(inv."olReservedQuantity"), 0)                                        AS "olReserved",
GREATEST(0, COALESCE(SUM(inv."availableQuantity" - inv."olReservedQuantity"), 0)) AS "availableToPromise"
```

`GREATEST` applies to the **sum**, not per row, so surplus at one location offsets a shortfall at
another — consistent with `totalAvailable` already summing across locations. `findStockAggregatesByProductIds`
keeps `totalReserved` meaning the master mirror and gains a parallel pair; **do not repoint it** (C2).

### Does OL double-count the master's own reservations?

**No.** `master-inventory-sync.service.ts:306-307` computes
`availableQuantity = inventory.available ?? (quantity - reserved)` — on both branches it is already
**net of master reservations**. `reservedQuantity` is stored purely as an informational mirror and is
subtracted nowhere. So `availableQuantity - olReservedQuantity` counts each reservation exactly once.

**Stated uncertainty:** that rests on every adapter's `inventory.available` being *net*. The
`?? (quantity - reserved)` fallback shows the intent, but an adapter reporting a gross `available`
alongside a non-zero `reserved` would silently over-promise. This is an adapter-contract assumption,
not an enforced invariant — write it into the `InventoryMasterPort` docblock as part of this wave.

The *second* double-count — the publish feedback loop — is real and is covered in § 6 C3a.

### Rejected alternatives

- **Ledger-only + advisory lock.** OL has no `pg_advisory_lock` anywhere; what exists is a Redis
  `SyncLockPort`, documented in both its call sites as TTL-bounded and *not* a correctness guarantee.
  Both existing uses have an idempotency backstop; oversell has none. It would also put Redis
  availability on the order-accept path.
- **`SERIALIZABLE`.** Correct, but OL's contention profile is its worst case — N marketplaces racing
  one variant means near-total serialisation failure under exactly the burst being defended against,
  and the whole codebase runs READ COMMITTED.
- **`SELECT … FOR UPDATE`.** Correct and low deadlock risk against the sync, but two round trips per
  line and it still needs a persisted counter. A fallback, not a win.
- **Exclusion constraint / CHECK over an aggregate.** Not expressible — a `CHECK` may not contain
  subqueries or aggregates, and `EXCLUDE` tests pairwise overlap, not a cross-table sum. Recorded so
  it is not re-litigated.

---

## 6J. Split and merge — disposition

**OL does not split or merge orders, and cannot.** Recorded here so it is not re-litigated.

### Why not

`identifier_mappings` is a **bijection per connection**: `UNIQUE (entityType, platformType,
connectionId, externalId)` and `UNIQUE (entityType, connectionId, internalId)`. Split needs 1→N,
merge needs N→1. The second index is not incidental — it exists so one internal id can carry
different external ids across *different* connections, which is what makes cross-destination routing
work.

Worked through concretely, each failure is worse than a constraint violation:

- **Split** produces a child order that is permanently unmappable on its origin connection. A
  marketplace cancellation of the original resolves to the parent, marks it cancelled, and **leaves
  the child live and shippable**. The split manufactures a ship-a-cancelled-order bug.
- **Merge** fails outright on the second index. Skip the remap and the loser order stays mapped, so
  the next `syncOrderFromSource` refreshes its snapshot with the lines that moved away — the merge
  un-merges itself on the next poll.

Preview would not survive either: `internalOrderId` is minted as a **side effect of the mapping
INSERT**, so previewing a new order would have to write.

### What the prior art does instead

Three different answers, tracking who each system's customer is. **Shopify splits the *fulfilment
order*, never the commercial order** — the commercial order is the contract with the buyer and the
anchor for tax, invoicing and the external id. **BaseLinker splits the commercial order** (new order
id) because its unit of work *is* the order — but appears to record **no lineage back-pointer**, and
every downstream breakage traces to that. **Sterling escalates**: split a line during scheduling, and
create a subordinate order only when a genuine lifecycle boundary exists. **Medusa, commercetools and
Vendure decline to model split/merge as an operation at all** — notably Medusa's 23 change-action
types include neither.

Sterling's ladder is the right fit, and OL sits on its first rung.

### What OL does instead

Option C from the grain decision: **line attribution on shipments**. `shipment_lines` keyed
`(shipmentId, orderId, lineId)` — note the `orderId`, which is what keeps *consolidated shipping*
(one parcel covering lines from two orders) open. That is the useful half of "merge" without touching
identity, and it costs nothing to include now on a table already being backfilled lossily.

**What is genuinely lost**, and should be stated to operators rather than discovered: two independent
dispatch SLAs (`dispatchByAt` is one column), per-part destination routing (`processorKind` resolves
once per order), and two invoices for two deliveries. None is expressible at any layer today.

---

## 7. Extensibility model

Three layers, with deliberately different answers. The decision that must be made **now** is layer 2.

### Layer 1 — Operator customisation (open, and the point)

Operator-defined stages, the Wave-3 rules engine (versioned draft/published like `PromptTemplate`,
with DB-enforced "exactly one published per scope" partial unique indexes), and per-connection
`config` policy. This is the BaseLinker-parity axis.

### Layer 2 — Plugin extensibility: **actions yes, states no**

**Decision: the canonical state axis stays core-owned; plugins may contribute *actions*.**

The prior art splits exactly on tenancy. Every hosted platform (Saleor, Shopify, Medusa) keeps state
core-owned and lets third parties contribute only actions and data. Every self-hosted one (Vendure,
Sylius, Spree) opened the state axis and then spent years managing it — Sylius retrofitted mandatory
callback priorities, Solidus has standing RFCs about state-machine overriding. A plugin-added state
is a permanent widening of every downstream `switch`.

Decisive: **you can open the state axis later; you cannot close it.**

Three boundaries copied from prior art:

- **Plugins supply triggers and actions, never conditions** (Shopify Flow). The predicate language
  stays core-owned — which is also what keeps D5's purity constraint intact, since a condition that
  can call plugin code is no longer a pure function and dry-run dies with it.
- **Enumerated named guards** (Vendure `configureDefaultOrderProcess`). Core decides *in advance*
  which invariants an operator may switch off, by name. **That list is a product decision and must be
  written before any code.**
- **Degrade-to-default on failure** (Saleor, Shopify). A throwing plugin action must never leave a
  half-applied transition. Vendure assigns its state *before* running `onTransitionEnd` and does not
  catch it — that is the trap, and the changeset model (ADR-040) avoids it structurally, since an
  action that throws is simply never marked `applied`.

**Prefer one handler per extension point** (Medusa) over a merge-array (Vendure): it turns a silent
ordering dependency into a loud startup failure. If multiple plugins must legitimately share a point,
adopt explicit priorities from day one — Sylius's retrofit is the evidence.

### Layer 3 — Not customisable

Canonical lifecycle states, the guardrails (idempotency, monotonicity, authority), and the money
non-goal. Stage labels map **one-way** onto the canonical axis and never feed the derivation.

### What this costs to build

A plugin **cannot** register an OMS action today. `HostServices` carries 14 registries, none of which
accepts a unit of operator-invocable work; scheduler tasks (the closest analogue) are drained once at
boot and can only enqueue a **closed core `JobType`**. The minimum additive change:

1. **`OmsActionDescriptor` + `OmsActionRegistryService`** in core — framework-free types file plus a
   `Map`-backed service keyed by `actionId`, exposing both `getAll()` (boot-time enumeration for the
   operator UI) and `get(id)` (runtime execution). Descriptor carries `actionId`, adapter/platform
   scope, a **mandatory** `requiredCapability`, a declared input schema (mirroring
   `PromptTemplateVariable[]` so the UI renders inputs without core knowing the action), and an
   `execute(connection, input, host)` that resolves its own port via `getCapabilityAdapter` so both
   capability gates fire.
2. **One `HostServices` field.** `HostServices` is not partial, so each of the four hand-rolled
   plugin modules (Allegro, PrestaShop, WooCommerce, Erli) needs the same one-line addition.
3. **A core caller** — nothing else in this repo registers into a registry with no consumer.
4. **A fan-out cardinality ceiling** (below).

### The two hazards this opens

**Fan-out.** The #2019 rate limiter **paces requests; it does not cap fan-out**. Today nothing stops
an unbounded fan-out *structurally* — what stops it is that no operator-authored artifact currently
triggers an outbound write (attribute rules only shape a payload someone else already decided to
send). **An OMS action would be the first artifact to cross that line**, so a per-invocation
cardinality ceiling must exist before the first rule-triggered action ships.

**Loops.** Unsolved in all prior art — nobody does static cycle detection. Shopify's only shipped
mitigation is runtime throttling plus a visible `Rate limited` run status the operator can see and
cancel. Treat loop safety as an **operator-facing observability** feature (causation-depth cap +
visible throttled status), not purely an engineering guard.

### An observation about OL's own conventions

The open-world pattern (`platformType`, `supportedCapabilities`, `PromptTemplateChannel` as bare
`string`) has been applied to **identity** axes — who and where — and never to **vocabulary** axes:
`AttributeMappingRuleKind`, `PlaceValueSource` and `SchedulerTaskConfig.jobType` are all closed
`as const`. An open action vocabulary would be the first of its kind here. That is a reason to decide
it deliberately, not a reason against it — but the #1841 attribute-rule precedent is the **wrong** one
to copy, since its closed vocabulary is exactly why plugins have zero involvement in it.
`PromptTemplate` is the right template.

Note finally that OL plugins run **in-process with full DI and TypeORM access**. Shopify pays for
third-party in-request logic with a WASM sandbox and a fuel budget; OL cannot. "Trusted-but-third-party"
must therefore mean genuinely trusted — code review plus the plugin list remaining a deliberate edit
point — and the action contract must promise degrade-to-default.

---

## 8. Testing strategy

| Subject | Level | Why |
|---|---|---|
| `derive-canonical-lifecycle` | unit, exhaustive precedence table | pure function; core domain logic target is 90%+ |
| Monotonic rejection + ledger claim | unit (repository port faked) + **int-spec** | the conditional `UPDATE` is a DB behaviour, not a code path |
| **D9 atomic reserve** | **int-spec, N=20 concurrent reserves of qty 1 against stock 10, over _separate connections_** | a concurrency guarantee cannot be proven by a unit test — and a shared TypeORM connection serialises at the driver and proves nothing. Assert exactly 10 succeed. The single most important test in the programme |
| Sync does not stomp `olReservedQuantity` | int-spec driving the **real** `MasterInventorySyncService` | pins the column-scoped write; catches a future refactor back to whole-entity `save()` |
| No double-count vs a non-zero master mirror | int-spec: `available=5, reserved=4, olReserved=2` ⇒ `totalAvailable=5`, ATP=3 | not 1, not −1 |
| Multi-line deadlock freedom | int-spec: two 2-line orders over the same pair in opposite order | proves the sort-by-`inventoryItemId` acquisition order; assert zero `40P01` |
| Shortfall clamp | int-spec: reserve 5, sync drops availability to 2 | UPDATE must succeed (no CHECK violation), ATP reads 0 |
| Changeset replay | unit — same fixture drives preview and apply | proves D5's purity constraint holds |
| Counter validation ladder | unit, one case per rung | each rung has an operator-readable message |
| Pack-event idempotency (`clientEventId`) | int-spec — duplicate insert | unique-constraint behaviour |
| Wave 4 Step 0 exhaustiveness | compile-time (`never` default) + unit per adapter | the point is that the compiler starts catching it |
| Station auth | int-spec + security review | new bearer-token surface |

New tables must be added to `tablesToTruncate` in the integration harness.

---

## 9. Checkpoint

**Treat the end of Wave 2 as a real gate.** At that point the Orders workspace and pack station
exist, and the foundation is paid for by the bug it fixed. Waves 3–5 should each require fresh
justification rather than inheriting today's approval.

---

## 10. ADRs

| # | Subject | State |
|---|---|---|
| [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) | Canonical lifecycle as a derived projection over a fact ledger | Proposed |
| [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) | Changeset model for remote-authority mutations | Proposed |
| — | `order_axis_transitions` as a third dedup layer (vs ADR-005, ADR-007) | to write |
| — | Ledger-as-outbox vs fire-after-commit | to write |
| — | `OrderAuthorityResolver` — per-(source, axis) coarse roles | to write |
| — | Self-echo posture: origin exclusion + outbound write records | to write |
| — | `connections.orderAuthority` (Posture A/B) | to write |
| — | **Late / out-of-order event policy** — no prior art in any surveyed platform | to write |
| — | Pack-station authentication | to write (before Wave 2 6D) |
| — | Rules engine: AST + capability-gated actions + purity constraint | to write |
| — | Returns as a child aggregate | to write |
| — | ADR-028 amendment | to write |

**`OrderAuthorityResolver` placement (W10).** `orders ↔ mappings` is already a package-level cycle,
tolerated because the `mappings → orders` half is `import type` only. Placing the resolver in
`mappings` passes the lint guard (symbol-shape, no cycle detection) **only** if it stays type-only
plus `I*Service` + token. `orders.module.ts:32` already imports `MappingsModule`, so a value import
back would need `forwardRef`. Prefer placing it in `orders`.

---

## 11. Open questions

1. **Open-core / paid module** — raised, undecided. Tension: the best-corroborated PL demand signal
   is pricing flight from the incumbent, and scanning is the cheap half of pack verification. If
   gating, gate hosting / support / agency dashboard / SSO, not warehouse basics. No entitlement
   infrastructure exists today.
2. **Dispatch declaration as a risk position** — `Szybka wysyłka` is max +160 / min 0 but only if
   ≤ 1 day is declared; `Wysyłka w terminie` runs to −360, and −460 from 26 August.
3. **Returns ambition** — Allegro permits read + reject-refund only. Is the value in disputes?
4. **Legal vs marketplace return state** — when the statutory withdrawal clock and the Allegro return
   disagree, which does the operator's screen show?
5. **COD reconciliation** — a batch-to-line join. Carrier API or bank-statement import?
6. **Allegro customer-returns status enum** — pull from `swagger.yaml` before Wave 4.
7. **Packing slips at the station** — in scope or out?
8. **Variants with no EAN** — manual tick, or scan the SKU?
9. **Batch packing** — out of v1; the standard is to batch the *pick* and single-thread the *pack*.

---

## 12. Risks

- Guardrails are non-optional and mostly absent; Wave 0 is not skippable
- Station auth is the largest new security surface
- Counter drift if 6B ships without the pack-event ledger (D2a)
- Rule loops through marketplace round-trips need a causation-depth cap
- Fan-out amplification: 5k orders × rules × actions against marketplace quota (#2019 limiter mitigates)
- Delayed-action staleness — no incumbent publishes an answer
- Stale-variant fail-open: rules must respect the #1689 guard
- Backfill of `order_record_items` for open orders
- Value concentrates in later waves while cost is front-loaded — hence § 8

---

## 13. Demand basis

Canonical record: [`product-spec-1032` § Gate D amendment](../specs/product-spec-1032-order-status-state-machine.md).
In short — a prospective agency's request fires **#827**'s defer condition but **none** of #1032's
three un-defer triggers; the reopening is a maintainer strategic-bet decision, not new trigger
evidence. Do not restate the reasoning here; amend the spec.
