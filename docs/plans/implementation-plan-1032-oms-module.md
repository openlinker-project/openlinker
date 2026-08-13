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

**Declared out of scope, with reasons** (previously just absent):

- **Order editing / amendment** — structurally impossible, not deferred. See § 6J: OL cannot change
  an order's composition.
- **Partial cancellation as an OL state** — no source can report it (§ 6J). Line-scoped *refunds* and
  *returns* are the honest expression.
- **Multi-currency conversion** — `OrderTotals.currency` is carried through from the source and never
  converted. OL reports the currency the buyer paid in; anything else is an accounting concern
  (ADR-014).
- **Ledger retention** — `order_axis_transitions` grows unboundedly. A retention policy (archive
  transitions for terminal orders older than N months) is **required before Wave 3**, since the rules
  engine multiplies transition volume. Not a Wave 0 blocker, but not indefinitely deferrable either.

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
| **D12** | **Backend authorization is `@Roles(...)`, not permissions.** Permissions drive UI visibility only | `frontend-architecture.md` § Access Control; `role.types.ts` doc comment — see § 6F |
| **D13** | **SLA is NOT an input to the canonical projection.** `canonicalState` is a function of recorded facts only; `slaState` stays a separate derived-on-read field | `deriveSlaState(dispatchByAt, fulfillmentState, now)` takes a wall clock. A materialised column fed by `now` is uninvalidatable — an untouched order crosses its deadline and stays stale forever |
| **D14** | **Shipping writes a fact to the ledger, not a column.** `OrderFulfillmentProjectionService` routes through `OrderAxisLedgerService`, which owns `canonicalState` recomputation | otherwise "the sole coordinating writer" is false on day one: `fulfillmentState` is written cross-context by an error-swallowing projection |
| **D15** | **Transition identity is `(internalOrderId, axis, causeType, causeId)` — all NOT NULL** | the `(…, originConnectionId, sourceEventId)` form leaves both NULL for every OL-origin fact, and Postgres NULLs don't conflict in a unique index, so pack / SLA / operator facts would dedup on nothing |
| **D16** | **Relay obligations live in their own table**, one row per `(transition, target)`; the transition row stays a pure fact | the relay fans out to N participants with per-target outcomes; one `relayState` enum cannot say "2 of 3 done, one unsupported, one failed" — the exact error D10 and § 1 forbid |
| **D17** | **Line attribution on shipments** (`shipment_lines`), no fulfilment-unit aggregate | [DECISION-oms-fulfilment-grain](./analysis/DECISION-oms-fulfilment-grain.md) — makes `shipped_quantity` derivable without re-graining dispatch, locks or FE |
| **D18** | **Process variation is a named `OrderFlow`, assigned per order**, not a pile of per-connection booleans. A flow may disable only an enumerated list of named guards | Fluent puts `orderType` in the workflow identifier; Sterling uses process type. BaseLinker's unbounded configurability needed Status Groups + action groups just to stay manageable — see [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md) |

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
polymorphic reference pair serve compositions that do not exist here.

**The revisit condition has been checked and does not fire.** Neither Allegro nor Erli supports
partial cancellation — verified by exhaustive path and schema enumeration of both OpenAPI specs, not
by absence of documentation. Allegro has **no order-cancel endpoint at all** (cancellation is a
buyer/system event the seller observes); `CheckoutFormLineItem` has no status or cancelled flag; and
`RETURNED` is documented as requiring that the buyer returns **all** items and the seller refunds
**all** of them. Erli's status write is `PATCH /orders/{id}/status` with no line parameter, and its
items carry no per-item status. See § 6J.

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
2. `derive-canonical-lifecycle.ts` — pure projection, sibling of `order-sla.ts`. **Consumes
   `deriveFulfillmentRollup` and the cancellation fact. It does NOT consume `deriveSlaState` (D13).**
3. Migration: `order_axis_states`, `order_axis_transitions`, `order_records.canonicalState`
4. `OrderAxisLedgerRepository` — conditional-claim + monotonic-UPDATE primitives
5. `OrderAxisLedgerService` — the sole coordinating writer, and the sole recomputer of `canonicalState`
6. **Re-route `OrderFulfillmentProjectionService` through the ledger (D14)** — shipping records a
   fulfilment *fact*; the ledger recomputes the column. Its existing error-swallowing becomes
   acceptable, because the Wave-1 sweep re-derives what a swallowed failure dropped
7. Re-route the three existing claim sites; delete `isFirst*Transition` **in the same commit**
   (they are today's only at-most-once guarantee; removing them early double-relays)

### Transition identity (D15)

`UNIQUE (internalOrderId, axis, causeType, causeId)`, **both cause columns NOT NULL**.

| `causeType` | `causeId` |
|---|---|
| `source-event` | `{originConnectionId}:{sourceEventId}` — external event ids are only connection-unique |
| `shipment` | `{shipmentId}:{toStatus}` |
| `pack` | `order_pack_events.id` |
| `sla` | `{dispatchByAt-epoch}:{threshold}` — deterministic, so a re-tick is a no-op |
| `operator` | `{userId}:{clientRequestId}` |
| `invoice` | `invoice_records.id` |

The earlier `(…, originConnectionId, sourceEventId)` form left both columns NULL for every OL-origin
fact, and NULLs do not conflict in a Postgres unique index — so the programme's central guardrail
would not have applied to the majority of Wave 2's traffic.

### Why SLA leaves the projection (D13)

`canonicalState` is materialised **solely** for SQL filter and sort, and a projection consuming `now`
cannot be invalidated by any write — an untouched order crosses `dispatchByAt` and stays stale
forever, so the one thing the column exists for is the one thing it would get wrong.

`slaState` therefore stays exactly as it is today: derived on read from `dispatchByAt` +
`fulfillmentState`, already exposed on the response DTO, already filterable. The orders list keeps
two independent controls — lifecycle and SLA — which is what `order-sla.types.ts` already asserts
("SLA is NOT a fifth health bucket"). No sweeper, no clock writer, no cache to invalidate.

**API contract decision (W2).** `canonicalState` is **additive** on
`order-record-response.dto.ts`; `fulfillmentState` and `slaState` keep their current enum-typed
meaning and keep driving the list badge and filters. Deprecating them is explicitly **deferred** —
until then the FE treats `canonicalState` as the headline and the other two as contributing detail.

**API contract decision (W2).** `canonicalState` is **additive** on
`order-record-response.dto.ts`; `fulfillmentState` and `slaState` keep their current enum-typed
meaning and keep driving the list badge and filters. Deprecating them is explicitly **deferred** —
until then the FE treats `canonicalState` as the headline and the other two as contributing detail.

### Wave 1 — Event path + durable relay

8. `events.order.lifecycle` stream + `OrderLifecycleToJobHandler` (clone `MasterDeletionToJobHandler`)
9. **`order_relay_attempts` — the obligation table (D16).** One row per `(transitionId,
   targetConnectionId)`:

   ```
   transitionId       text NOT NULL
   targetConnectionId uuid NOT NULL
   state              text NOT NULL   -- pending | done | unsupported | failed
   attempts           int  NOT NULL DEFAULT 0
   lastError          text NULL
   nextAttemptAt      timestamptz NULL
   leasedUntil        timestamptz NULL
   UNIQUE (transitionId, targetConnectionId)
   ```

   The transition row goes back to being a pure **fact**; the obligation is separate and per-target,
   which is what a fan-out to N participants actually is. `OrderWritebackUnsupportedReason` already
   distinguishes structural (`no-capability` → terminal `unsupported`) from transient
   (`adapter-unresolved` → retryable) — use it rather than inventing a second vocabulary.
10. **The relay sweep**, closing the four failure windows explicitly:
    - *commit then crash before publish* → sweep re-drives from `pending`
    - *remote write succeeded, crash before marking done* → **the outbound call must carry an
      idempotency key derived from `(transitionId, targetConnectionId)`**, or the sweep duplicates a
      mark-sent or a cancel at the marketplace
    - *permanent failure* → `attempts` + exponential `nextAttemptAt` + a terminal `failed` state that
      stops the sweep and raises an operator-visible row. No infinite re-drive
    - *sweep racing the stream consumer, or two sweep instances* → `leasedUntil` claimed with the
      same conditional-UPDATE primitive Wave 0 builds
11. ADR-028 amendment: cancellation → stock-restore becomes an event consumer
12. Exploit Allegro's `checkoutForm.revision` / 409 CONFLICT for safe status write-back

**Honest note on Wave 0's standalone justification.** Wave 0 alone *replaces* three ad-hoc claims but
does not by itself fix the lost-cancel bug — today's relay fires after the shipment write, so a crash
between them already loses it, and a durable claim taken before the relay makes that loss
re-poll-proof rather than repaired. **The fix is the Wave-1 sweep.** Waves 0 and 1 should therefore be
planned and gated as one unit; the "Wave 0 pays for itself independently" claim holds only for the
consolidation of the three claims, not for the bug.

### Wave 2 — Operator workbench (see § 6)

Adopts **option C** from [DECISION-oms-fulfilment-grain](./analysis/DECISION-oms-fulfilment-grain.md) (D17):

13. **`shipment_lines`** — `(shipmentId, orderId, lineId, quantity)`, unique on the triple. The
    `orderId` is deliberate: it is what keeps *consolidated shipping* (one parcel covering lines from
    two orders) expressible, and it costs nothing on a table being created now
14. **Prerequisite — fix `prestashop-order.mapper.ts:53`.** `String(row.id || index)` uses an
    array-index fallback, `||` where `??` is meant, and can collide an index-derived id with a real
    `row.id`. Harmless today (error-message only); **structural** once `shipment_lines` keys on it.
    Fix the mapper or assign an OL-side reconciled surrogate — this blocks item 13
15. **Fix `fulfillment-rollup.ts` precedence in the same change.** "Any `delivered` ⇒ `delivered`" is
    correct for cancel-and-reissue and **wrong** under partial coverage, where one delivered shipment
    of three would report the whole order delivered. It must compare covered quantities against
    ordered quantities
16. **Backfill writes ledger events, not counters.** Historical line scope is unrecoverable — no
    column, no dispatch audit, no persisted `GenerateLabelCommand` — so the only backfill is
    "one shipment covers all lines". Written as events it is compensable for the cancel-and-reissue
    pairs it double-counts; written as counters the double-count is permanent

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
16. **`ReturnLine`** — carries `requestedQuantity`, **`receivedQuantity`**, **`damagedQuantity`**,
    `reasonCode`, `reasonNote`. The quantity split is a four-system consensus (Medusa
    `received`/`damaged`; Shopify processable/processed/refundable/refunded; commercetools
    BackInStock vs Unusable) — no single field says "3 came back, 1 is scrap".

    **Key it on the source's own reference, not on an order line.** Allegro's
    `CustomerReturnItem` carries **`offerId`, not the checkout-form `lineItems[].id`** — so
    attribution back to an ordered line requires joining on `offer.id`, and **that join is not
    unique**: one checkout form can legitimately hold two lines for the same offer. Store
    `(externalItemRef, quantity)` as authoritative and treat the link to an order line as a
    **best-effort resolution that may be ambiguous**. An unresolvable attribution is an
    operator-facing needs-attention state, not a silent guess.

    **`ReturnLine` carries no status.** Allegro's rejection is whole-return
    (`POST /order/customer-returns/{id}/rejection`), and there is no per-line status anywhere.
17. **Reason codes are their own vocabulary**, per line, never reusing order-status codes. Allegro's
    ~17 reason types are a **prose list, not a formal enum** in the spec — validate leniently.
    Erli's are a different closed set.
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

### Source-shape constraints the returns model must absorb

- **Allegro's return `status` is not a state machine.** Its 11 values interleave four axes —
  logistics (`DISPATCHED`/`IN_TRANSIT`/`DELIVERED`), settlement (`FINISHED`/`FINISHED_APT`),
  commission (`COMMISSION_REFUND_CLAIMED`/`COMMISSION_REFUNDED`) and fulfilment-warehouse
  (`WAREHOUSE_*`). The spec itself calls it a *"timeline"*. Projecting it verbatim is honest but hard
  to filter; decomposing it into facets is usable but means OL is interpreting. **Decide explicitly
  before Wave 4** — modelling it as a single state machine will mis-fire.
- **Erli returns have no status at all** — they are a fact, not a workflow, embedded read-only on
  `Order.returns[]` with no return id and no reject action. Any cross-platform `Return.status` carries
  an unavoidable `unknown` for every Erli return.
- **Two adapter traps, both verified in the specs.** Erli's quantity field is misspelled
  **`quentity`** — an adapter reading `quantity` silently gets `undefined`. And its line reference is
  a **positional `index` into `Order.items[]`**, not an id, despite `items[].id` existing; resolve
  `index → items[index].externalId` at ingest and persist the resolved id, never the index.
- **Allegro customer-returns is `[BETA]`** (`application/vnd.allegro.beta.v1+json`), and its only
  write is the rejection. Read + reject is the whole surface — this is what caps Wave 4's ambition.
- `CustomerReturn.refund` carries **no amount and no refund status** — only a bank account. Whether
  money moved is inferable only from `status ∈ {FINISHED, FINISHED_APT}`. This is why refund intent
  and refund execution must stay separate (item 22).

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
25. Reserve on ingestion; **close on OL's own dispatch event** (§ 6 C3a); expiry sweeper as a safety
    net only. Plus the **reconciler** (`inventory.reservation.reconcile`) — the counter is
    denormalised over a ledger and drift here silently oversells (§ 6I)
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

**D2a — every counter now has a real source.** `packed_quantity` derives from `order_pack_events`;
`shipped_quantity` and `delivered_quantity` derive from **`shipment_lines` joined to shipment status**
(the gap option C closes — before it, those two had no derivable source and would have been exactly
the free-floating integers D2a forbids); return counters derive from `ReturnLine`. No counter is
written directly.

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

Two layers: a long-lived **device session**, plus a **per-order actor** resolved by PIN or badge scan
and stamped on each pack event.

**The device session is authorized by its own guard, not by permissions and not by the role ladder**
(D12 — permissions are display-only). It is a distinct principal type with an explicit allowlist of
endpoints: pack-event write, stage transition, and reading orders in packable stages. It reaches
nothing else — no settings, no connections, no credentials, no other orders. Treat the allowlist as
the security boundary and pin it with a spec, the way `write-guard-coverage.spec.ts` pins the role
guards.

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

- **Fast path:** 6B → 6C → 6A → Wave 0/1 later.
- **Foundation first:** Wave 0 → 1 → 2. Cleaner; nothing user-visible for longer.

**The fast path's cost is not "one column" — that claim was wrong.** It is:

1. a **throwaway guard** — 6A's invariant is "moving to a stage is legal iff the implied canonical
   transition is legal". Without the canonical graph you ship either no guard (operators corrupt
   sequencing on live data) or a second guard over `fulfillmentState`/`cancelledAt` that is discarded;
2. a **migration of operator-authored data** — stage rows carry a persisted `canonicalState`, so
   re-binding migrates customer rows, not a schema column;
3. **6C's auto-advance and 6E's dispatch gate** move with the throwaway guard;
4. a **UI and vocabulary migration** — the badge ships bound to `fulfillmentState`, then a second
   headline field appears.

Also a cross-wave dependency previously missed here: **Wave 5's `inventory_reservations.orderLineId`
depends on Wave 2's `order_record_items`.**

Recommended: **fast path**, with that cost stated and accepted.

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

**Resolved: close the reservation on OL's own dispatch, and bound the window.** The original mitigation
("close on the event that causes the master to decrement") is unsatisfiable — OL observes no such
event. Master stock arrives via `MasterInventorySyncService`, a poll that rewrites `availableQuantity`
wholesale with no per-order causality. Nothing anywhere means "the master decremented for this order".

What OL *does* observe is its own dispatch. So a reservation transitions to `consumed` when the
shipment covering its line dispatches — an event that exists, is durable, and is already the trigger
for the waybill relay. The double-count then lasts from dispatch until the next master sync, which is
**bounded by the sync interval** rather than unbounded. That is a materially different risk from the
original formulation and is acceptable; state the window in the release notes so an operator reading a
briefly-low published quantity is not surprised.

The expiry sweeper remains a safety net for abandoned reservations, never the normal close path.

*(Superseded: the earlier text required closing on "the same lifecycle event that causes the master to
decrement". No such event exists in OL, so the requirement could never be met. Recorded here so the
reasoning is traceable.)*

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
  ON "inventory_reservations" ("orderRecordId", "orderLineId", "inventoryItemId")
  WHERE "status" = 'held';
```

That partial unique index **is** the idempotency key — a retried reserve fails the insert instead of
double-incrementing. Same idiom as the two partial unique indexes already on `inventory_items`.

**The key must carry `orderRecordId`.** `orderLineId` is the *source-supplied* `OrderItem.id`, unique
only within an order — Allegro and PrestaShop line ids collide across orders trivially. Keyed on
`orderLineId` alone, order B's reserve fails against order A's unrelated held row, the transaction
rolls back, and the operator sees "insufficient stock" with stock plainly available. `inventoryItemId`
is in the key so a line can hold reservations at more than one location once sourcing exists.

### Location scope — explicitly single-location in v1

ATP sums across locations while a reservation row names one `inventoryItemId`, so in principle a line
could be promised stock the reserve path cannot take. **In practice this is latent, not live: no
adapter emits a non-null `locationId`** (PrestaShop and WooCommerce both hardcode it), and the write
path already skips non-default locations. Every row is single-location today.

v1 is therefore explicitly single-location, and **multi-location reservations are blocked on a
sourcing rule** — "which `inventoryItemId` do we reserve against?" — which does not exist anywhere in
OL and is the first question an allocation wave must answer. Recorded as a prerequisite rather than
discovered mid-wave.

### Shortfall path

When the master lowers `availableQuantity` below `olReservedQuantity`, the delta is a **shortfall**.
It is a fact, not an error: the reserve UPDATE is not retro-actively invalid, and the CHECK
deliberately does not forbid it (a constraint there would make the *sync* fail).

Handling: ATP clamps to 0 on read; the affected order surfaces in the existing needs-attention
bucket with a distinct reason; the stock-at-risk view shows the gap. **Nothing auto-cancels and
nothing auto-releases** — an operator decides. This is the path § 6I referenced three times and never
specified.

### Reconciler

`olReservedQuantity` is denormalised state over a ledger, so it can drift — from a partially-failed
expiry sweep, a manual DB edit, or any bug. Unlike `fulfillmentState`, drift here silently oversells
or silently blocks sales, so a reconciler is **not optional**:

A scheduled `inventory.reservation.reconcile` job compares, per `inventoryItemId`,
`SUM(quantity) WHERE status = 'held'` against `olReservedQuantity`; corrects the counter to the
ledger (the ledger is authoritative); and logs every correction with the delta. A non-zero correction
rate is a defect signal, not routine maintenance — alert on it.

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

### Partial cancellation is not a marketplace concept

Verified against both OpenAPI specs: **neither Allegro nor Erli supports cancelling part of an
order.** Cancellation is a whole-order terminal state on both.

What Allegro *does* offer is line-scoped **refunds** — `POST /payments/refunds` takes
`RefundLineItem { id, type: AMOUNT | QUANTITY, quantity, value }`, with reasons including
`PRODUCT_NOT_AVAILABLE` and `CANCELLED_BY_BUYER`. So a seller effects a de-facto partial cancellation
by refunding the affected lines and shipping the rest. Commission-refund claims are likewise
line+quantity scoped (`RefundClaimRequest { lineItem: { id }, quantity }`).

**OL should model what the sources report, not invent a state none of them can express.** Whole-order
cancellation, plus line-scoped returns and refunds. A first-class "partially cancelled" OL state would
be unreportable by every source and settable only by inference.

Note this does not reopen the actions-table decision: a refund of N lines is **one remote call
carrying a line array**, not N independently-applied actions.

### One unresolved tension

Allegro's `OrderLineItem` (the *event* shape) allows `quantity: minimum: 0`, while
`CheckoutFormLineItem` (the *order resource* shape) requires `minimum: 1`. Combined with the
`BUYER_MODIFIED` event — documented in full as *"purchase modified by buyer"* — the spec neither
supports nor excludes a per-line reduction arriving through the event journal.

This matters because **OL currently detects no line-level change at all**: ingestion reads the prior
record only for its status and never compares `orderSnapshot.items`, and persistence rewrites the
snapshot wholesale. A line that shrinks or disappears between polls does so silently — no event, no
log, no record-status change — and any dispatched shipment referencing it is left dangling. That is a
gap today, independent of this plan, and it is tracked separately.

---

## 6K. Flows — adapting to different warehouse processes

**D18 / [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md).**
Different clients — and different order types within one client — work differently. That variation is
modelled as a **named flow**, not as independent settings.

### The entity

`order_flows` — operator-defined, seeded with one `Default` flow reproducing today's behaviour.

| Column | Notes |
|---|---|
| `name`, `isDefault`, `isActive` | |
| `verificationMode` | `none` · `manual` · `scan` · `scan-where-possible` |
| `dispatchGate` | `off` · `warn` · `block` |
| `packingSlip` | `none` · `browser` · `print-server` |
| `packGrain` | `single-order` · `multi-order-batch` |
| `disabledGuards` | the enumerated allowlist, below |

**`order_stages` gains `flowId`** — the stage pipeline *is* the core of a flow, so stages belong to
one rather than existing globally (amends § 6A).

### Assignment

`order_records.flowId`, **stamped at ingestion**, resolved by an `OrderFlowResolver` mirroring
`FulfillmentRoutingService`'s shape: rules keyed on `(sourceConnectionId, sourceDeliveryMethodId,
orderType?)`, returning `{ flowId, source: 'rule' | 'default' }`. Nullable, lazily resolved, so
existing orders are unaffected and nothing needs configuring for the system to work.

Stamped rather than resolved-on-read, deliberately: a flow change must not silently re-route work
already in flight, and an auditor needs to know which process an order actually went through.

### `scan-where-possible` — the honest answer to missing EANs

Scan verification resolves a barcode against `ProductVariant.ean`. A variant without one cannot be
scanned. Under `scan-where-possible`, a line **that carries an EAN must be scanned**; a line without
one may be ticked, and the UI says which is which. The dispatch gate then treats a tick as verified
*only* for lines that were unscannable.

Without this, "fully verified" silently means "verified except the bits we couldn't check".

### The named-guard allowlist

A flow may disable **only** these, by name:

| Guard | Effect when disabled |
|---|---|
| `requireScanVerification` | manual tick accepted for all lines |
| `blockDispatchUntilPacked` | gate degrades to warn, or off |
| `requireAllLinesPackedToAdvance` | short-pack auto-advances instead of holding |
| `requirePackingSlipPrinted` | completion does not wait on a print |

**Not disableable, ever:** the canonical lifecycle axis and its precedence; the guardrails
(idempotency, monotonicity, relay obligations); the identity constraints (§ 6J); the counter
validation ladder (`packed ≤ ordered`, `shipped ≤ packed`, `delivered ≤ shipped`).

A flow governs *how an operator moves through the work*. It never changes *what OL believes
happened* — stage labels still map one-way onto the canonical axis.

### Containing the test-matrix cost

The obvious risk is N flows × every pack behaviour. Mitigate structurally: **flow is a pure input to
one policy-resolution function**, not a branch through the pack service. `resolveFlowPolicy(flow,
line, order)` is unit-tested per axis; the pack station is tested once against a resolved policy. No
`if (flow.packGrain === …)` scattered through services.

### Open

**Is a flow assigned to the order, or chosen by the packer at the bench?** Assigned (above) is
simpler, auditable and reportable. Bench-chosen is more flexible but means the flow is not a property
of the order at all, which changes where it is stored and whether it can be reported on. Assigned is
the recommendation; confirm against how the agency's clients actually work.

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
| Shortfall clamp | int-spec: reserve 5, sync drops availability to 2 | UPDATE must succeed (no CHECK violation), ATP reads 0, order surfaces in needs-attention |
| Reservation key scoping | int-spec: two **different orders** whose source line ids collide | order B must reserve successfully — this is the defect the `orderRecordId` key fixes |
| Reconciler | int-spec: corrupt `olReservedQuantity` directly, run the job | counter converges to `SUM(held)`, correction logged |
| Transition identity for OL-origin facts | int-spec: fire the same pack/SLA fact twice | exactly one transition row — proves the D15 NOT-NULL cause key |
| Relay obligation fan-out | int-spec: 3 targets, one `no-capability`, one failing | three `order_relay_attempts` rows with distinct terminal states; sweep re-drives only the retryable one |
| Relay idempotency across a crash | int-spec: mark remote done, crash before `state='done'`, sweep | outbound carries the `(transitionId, targetConnectionId)` key; no duplicate mark-sent |
| `shipped_quantity` derivation | unit + int-spec over `shipment_lines` × shipment status | the counter that had no source before option C |
| Rollup under partial coverage | unit: 1 of 3 shipments delivered | must NOT report the order delivered — the latent `fulfillment-rollup.ts` bug |
| **Flow policy resolution** | unit, **one case per axis**, not per flow combination | this is what keeps the flow matrix from multiplying: flow is an input to `resolveFlowPolicy`, never a branch in the pack service |
| `scan-where-possible` | unit: mixed order, some lines with EAN, some without | EAN lines must require a scan; only unscannable lines accept a tick |
| Flow assignment | int-spec: ingest with a matching rule, and without | stamped `flowId`, `source: 'rule' \| 'default'`, and a null-flow order still works |
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
| [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) | Proposal record for remote-authority mutations (composition machinery deferred) | Accepted |
| [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md) | Order flows as named operator-process configuration | Proposed |
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
6. ~~**Allegro customer-returns status enum**~~ — **closed.** Pulled from `swagger.yaml`; the 11
   values and every field are recorded in § 5 Wave 4. Note it is `[BETA]`.
6a. **Does OL project Allegro's return status verbatim, or decompose it into facets?** It interleaves
   four axes; verbatim is honest but unfilterable, decomposed is usable but interpretive.
6b. **Is an unresolvable return-to-order-line attribution an operator-facing needs-attention state?**
   Allegro returns key on `offerId`, and the join to an ordered line is not unique.
6c. **`OrderItem.id` is unstable on PrestaShop** — `prestashop-order.mapper.ts:53` is
   `String(row.id || index)`: an array-index fallback, plus `||` rather than `??` so a legitimate
   `row.id === 0` also falls through, and an index-derived id can collide with a real `row.id`.
   Harmless today (used only to build an error message) but **structural** if `shipment_lines` keys
   on it. Fix the mapper, or have OL assign a reconciled surrogate line id. Allegro, Erli and
   WooCommerce all pass through stable platform ids — though WooCommerce reassigns them when an
   order is edited in wp-admin.
7. ~~**Packing slips**, **no-EAN variants**, **batch packing**~~ — **closed as questions, reopened as
   defaults.** All three are now flow axes (§ 6K), so the question is no longer "which behaviour do we
   build" but "what should the seeded `Default` flow say". Confirm with the agency: is their clients'
   common case `scan-where-possible` + `block` + `single-order`, and do they print slips today?
8. **Is a flow assigned to the order, or chosen by the packer at the bench?** Assigned is
   recommended — simpler, auditable, reportable — but it is a real fork (§ 6K).

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
