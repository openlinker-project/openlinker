# Implementation Plan — #1032 OMS module

**Parent issue:** #1032 (reopened 2026-08-13)
**Spec:** [`docs/specs/product-spec-1032-order-status-state-machine.md`](../specs/product-spec-1032-order-status-state-machine.md)
**Readiness gate:** [`analysis/ANALYSIS-implementation-plan-1032-oms-module.md`](./analysis/ANALYSIS-implementation-plan-1032-oms-module.md)
**Status:** **NOT READY TO IMPLEMENT AS A SIX-WAVE PROGRAMME.** Eight adversarial stress tests were
run against this plan — one per wave plus three against the cross-cutting ADRs. **All eight found
disqualifying defects.** What survives is in § 0. The rest is retained as reference, clearly marked,
because the research is sound even where the design is not.

> Supersedes the scoping in #2064 (closed as duplicate of #1032).
> [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) is Accepted.
> **[ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) is reverted to
> `Proposed`** pending the four preconditions in § 0.

---

## 0. Stress-test outcome — what actually ships

Eight passes, eight disqualifying findings, one recurring disease: **the mechanism is specified to
the SQL while the premise that justifies it is unexamined.** Recorded honestly because the pattern is
the most useful output of this exercise.

| Section | Verdict | The finding that killed it |
|---|---|---|
| ADR-040 composition | narrowed | `identifier_mappings` is a bijection per connection; split ships a cancelled order |
| ADR-041 flow entity | narrowed | containment claim disproved by its own signature; `orderType` has zero referents |
| Wave 3 rules engine | **cut** | OL has one useful stream with ≤6 cause types; 1 of BaseLinker's 10 triggers servable |
| Wave 4 returns aggregate | narrowed to a projection | 6-value enum with one derivable value; restock rejects on PrestaShop |
| Wave 5 allocation | **cut** | `omp_fulfilled` is the default and OL never dispatches there → worse than shipping nothing |
| **Wave 1 relay** | **cut** | the lost-cancel bug it exists to fix produces **zero obligation rows**; and it is #861 unannounced |
| **Wave 0 ledger** | **cut** | the axis vocabulary is never defined; `canonicalState` is a pure function of two already-indexed columns |
| **Wave 2 workbench** | **split; only 2a survives** | `shipped_quantity` is permanently 0 on the default routing kind; the station principal breaks `RolesGuard` |

### What is actually worth building

Five items. Each closes a **verified** defect, each is independently valuable, none needs a new
architecture:

1. **`WHERE cancelledAt IS NULL` in the provisioning path.** Closes the lost cancel — the one real
   bug this whole programme was organised around. `order-record.orm-entity.ts:92` already names it
   as the missing half (`#1987/#1988`), and `markCancelled` already stamps durably first-write-wins.
   A predicate, not a table plus a sweep plus a stream.
2. **Fix `prestashop-order.mapper.ts:53`** — `String(row.id || index)`. Use `??`, drop the index
   fallback, fail loudly on a missing id. An index-derived id shares a namespace with real
   `id_order_detail` values, so two physically distinct lines can collide **today**.
3. **`InventoryRepository.upsert` column-scoping.** Column-scoped today only as an emergent property
   of TypeORM's `save()` diffing — too thin a basis for an oversell guarantee. A live latent bug.
4. **`order_records.packedAt` + `packedByUserId`, one endpoint, one toggle, one list column.** This
   is the agency's actual ask — *"whether it's packaged"* — answered for **100% of orders including
   `omp_fulfilled`**, which the seven-counter design does not manage. Zero new tables, no new
   principal type, no hardware, no ADR.
5. **A terminal-relay-failure signal.** A relay that fails forever currently produces `logger.error`
   and a `succeeded` job. That is the one genuine gap the null hypothesis leaves, and it is a counter
   column, not a distributed-systems programme.

### What the ask actually needed

> *"showcase the order, its status, if it's packaged"*

- **the order** — already ships.
- **its status** — already ships **four times over** (`OrderHealth`, `fulfillmentState`, `slaState`,
  `syncStatus[]`). The honest deliverable is **subtraction**: pick one headline, demote the rest.
  This plan proposed adding a fifth (`canonicalState`) and a sixth (`order_stages`).
- **whether it's packaged** — the only genuinely absent fact, and it is **one boolean**.

Everything above that boolean was justified by a *per-line* claim ("3 of 5 packed") nobody asked for,
which § 6 F1 shows the system cannot answer for its own default routing kind.

### If the larger programme returns, these are preconditions

For the axis ledger (ADR-039), all four before it leaves `Proposed`:

1. **The enumerated axis and canonical-state vocabularies.** The plan specifies
   `UNIQUE (internalOrderId, axis, causeType, causeId)` and `NOT NULL` for a table whose value domain
   it never states. `order_stages.canonicalState` would be operator-authored data keyed on an
   undefined enum.
2. **A stated relationship to `OrderStatus` / `order_state_mapping`** — the existing canonical enum,
   persisted, validated, with a CRUD UI, and the *only* outbound translation surface OL has. If
   `canonicalState ≠ OrderStatus` the stage chain terminates in a value no adapter can be told about;
   if it equals it, D1's "never a stored contested scalar" is false on arrival.
3. **A stated relationship to the `OrderHealth` partition** — five buckets whose own comment is "the
   single source of truth", encoded three times, existing so the KPI cards sum to total. The plan
   mentions `recordStatus`, `syncStatus` and `OrderHealth` **zero times** between them.
4. **A named producer in existing code for every `causeId`.** `operator → {userId}:{clientRequestId}`
   has no `clientRequestId` convention anywhere; `source-event` collapses to `conn:undefined` on the
   paths where `sourceEventId` is null; and there is no cause type for the waybill backfill at all,
   which is the single most load-bearing relay in the codebase.

---

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
| ~~D4~~ | ~~Rules engine = hand-rolled versioned condition AST~~ — **withdrawn.** Wave 3 ships SLA escalation as a **named core feature**; the engine is deferred behind a falsifiable premise | OL emits **three** event streams (one with no consumer); after Wave 2 the usable trigger surface is one stream with ≤6 cause types. Of BaseLinker's ten trigger categories OL can serve **one**. `AutoIssueTriggerService` already does hard-coded orchestration in ~150 lines — see § 5 Wave 3 |
| ~~D5~~ | ~~Dry-run is the differentiator, and nearly free~~ — **withdrawn.** | it was justified as "preview and apply are one replay function" — but [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) **deferred the replay function**. The claim named a component that no longer exists, and a realistic condition needs 6–8 reads to assemble, so it is not pure either |
| D6 | Returns is a **child aggregate**, not an axis | axis rows are one per order×axis; returns are N per order |
| D7 ~~*(Wave 5 cut; retained as reference)*~~ | Reservations get their **own table**; never overload `inventory_items.reservedQuantity` | that column is a master mirror, rewritten on every sync |
| D8 | Invoice issuance is an **observed** event keyed on the KSeF-returned date | art. 106na — the legal issue date is assigned at transmission |
| D9 ~~*(Wave 5 cut; retained as reference)*~~ | **Invert Medusa's concurrency model**: an atomic conditional UPDATE + CHECK constraint against an **OL-owned counter column** (`olReservedQuantity`), never the master mirror — see § 6I | Medusa has zero `FOR UPDATE`, zero CHECK constraints, read-then-write LWW; no surveyed OSS platform does better |
| D10 | Lifecycle facts as **independent nullable timestamps**, not one enum | a single flag cannot carry both "did it happen" and "did we relay it" (#1947) |
| **D11** | **`totalAvailable` keeps its current meaning (raw available). ATP is a NEW field.** | Redefining it is a silent semantic break across **7** consumers (one, `erli-order-source.adapter.ts:634`, **outside core**) with zero compile errors — see § 6 C2 |
| **D12** | **Backend authorization is `@Roles(...)`, not permissions.** Permissions drive UI visibility only | `frontend-architecture.md` § Access Control; `role.types.ts` doc comment — see § 6F |
| **D13** | **SLA is NOT an input to the canonical projection.** `canonicalState` is a function of recorded facts only; `slaState` stays a separate derived-on-read field | `deriveSlaState(dispatchByAt, fulfillmentState, now)` takes a wall clock. A materialised column fed by `now` is uninvalidatable — an untouched order crosses its deadline and stays stale forever |
| **D14** | **Shipping writes a fact to the ledger, not a column.** `OrderFulfillmentProjectionService` routes through `OrderAxisLedgerService`, which owns `canonicalState` recomputation | otherwise "the sole coordinating writer" is false on day one: `fulfillmentState` is written cross-context by an error-swallowing projection |
| **D15** | **Transition identity is `(internalOrderId, axis, causeType, causeId)` — all NOT NULL** | the `(…, originConnectionId, sourceEventId)` form leaves both NULL for every OL-origin fact, and Postgres NULLs don't conflict in a unique index, so pack / SLA / operator facts would dedup on nothing |
| **D16** | **Relay obligations live in their own table**, one row per `(transition, target)`; the transition row stays a pure fact | the relay fans out to N participants with per-target outcomes; one `relayState` enum cannot say "2 of 3 done, one unsupported, one failed" — the exact error D10 and § 1 forbid |
| **D17** | **Line attribution on shipments** (`shipment_lines`), no fulfilment-unit aggregate | [DECISION-oms-fulfilment-grain](./analysis/DECISION-oms-fulfilment-grain.md) — makes `shipped_quantity` derivable without re-graining dispatch, locks or FE |
| **D18** | **Pack policy is a validated per-connection config pair** (`verificationMode` + `dispatchGate`); stages stay global. The named-`OrderFlow` entity is **deferred** to the Wave-2 gate | a stress test disproved the entity's own containment claim (`packGrain` cannot be a resolved value), found its guard allowlist duplicated its axes, found no versioning, and found `orderType` has zero occurrences in `libs/core/src` — see [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md) |

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

**Dry-run is not delivered by this plan at all.** An earlier draft moved it from here to the rules
engine; the rules engine was then cut (§ 5 Wave 3), and the move had already broken it — the claim
"preview and apply are one replay function" named the replay function this ADR defers. Recorded so
the differentiator is not re-asserted a third time without a design behind it.

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

### Wave 0 — Lifecycle foundation (**CUT**; retained as reference)

> **Cut by stress test.** Three disqualifying findings:
> 1. **`canonicalState` is a pure function of two already-indexed columns** (`fulfillmentState`,
>    `cancelledAt`). ADR-039 rejects "recompute on read" because filtering needs an indexable column —
>    but OL has shipped that exact rejected pattern three times (`HEALTH_ORDINAL`,
>    `FULFILLMENT_ORDINAL`, `applySlaFilter`). The materialised column buys nothing.
> 2. **The ledger cannot hold the fact that justifies it.** The lost cancel has no internal order id —
>    that *is* the bug — and the ledger is keyed `internalOrderId NOT NULL`.
> 3. **Item 7 deletes a *releasable* claim and installs an *unreleasable* one, one wave early.**
>    `claimWaybillRelay` is claim-then-release-on-failure; an append-only row has no release. Between
>    Wave 0 and Wave 1 merging, a throwing relay strands the claim forever with no sweep — strictly
>    worse than today.
>
> See § 0 for the four preconditions before this returns.


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

### Wave 1 — Event path + durable relay (**CUT**; retained as reference)

> **Cut by stress test.** Four disqualifying findings:
> 1. **The lost-cancel bug it exists to fix produces zero obligation rows.** `order_relay_attempts`
>    is keyed per resolved target; the code comment states the race exactly — a cancel arriving before
>    provisioning *"finds no targets here"*. No targets → no rows → nothing for the sweep to re-drive.
>    The sweep re-drives writes that were attempted and failed; this one was never attemptable.
> 2. **It is #861 unannounced.** A `[PRODUCT-DESIGN]` issue whose stated output is its own ADR
>    covering four projectors. `grep 861` over this plan returned **zero**.
> 3. **The waybill backfill has no identity under D15.** It fires on a `trackingNumber` null→value
>    transition *independent of status*, so the common case produces no transition at all — or
>    collides on the unique index with the dispatch transition. Both branches lose the waybill,
>    reproducing #1947's original defect. D15 has six cause types and none is `waybill`.
> 4. **The mandatory idempotency key cannot be plumbed.** `OrderStatusWriteback.write(event)` takes
>    one parameter, and neither Allegro's fulfillment PUT nor Erli's PATCH accepts an idempotency
>    header. The idempotency that works is outcome-shaped (409⇒already-sent) and already shipped.
>
> Item 12 (Allegro 409 write-back) was **already shipped in #1947**, with specs.


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

### Wave 2 — Operator workbench (**SPLIT**; only 2a survives — see § 6)

> **Split by stress test.** Three independently disqualifying findings, then a scale problem:
> 1. **`shipped_quantity` / `delivered_quantity` are permanently 0 on the default routing kind.**
>    `createBranchOneShipment` builds `omp_fulfilled` shipments from an order-grain snapshot carrying
>    **nothing line-level**. An order shipped and delivered by PrestaShop reads "0 of 5 shipped".
>    That is the exact failure D17 was adopted to fix.
> 2. **`lineId` is not stable, and `??` does not make it stable.** The snapshot is rebuilt on every
>    ingest; `shipment_lines.lineId` is a text key into a JSONB array with no FK. The plan's escape
>    hatch — "an OL-side reconciled surrogate" — is a matching algorithm over re-polls, i.e. a design,
>    not a prerequisite line item.
> 3. **§ 6B's return counters reference a table this plan deleted.** `ReturnLine` was cut when Wave 4
>    narrowed to a projection; `return_received_quantity` has no observation on either platform and is
>    warehouse mechanics, a declared § 1 non-goal.
>
> **Scale:** 6 tables, ~17 endpoints (a ~9% increase in OL's entire API surface), and a second
> frontend application with its own auth — in one wave. Three disjoint risk profiles, which is what
> lets the pack station's unresolved auth question hide behind the counters' tractability.
>
> **Ships as 2a only:** the mapper fix, `order_record_items` with **three** counters (`ordered`,
> `shipped`, `delivered`), `shipment_lines` **including** the branch-1 writer, and the
> `fulfillment-rollup` precedence fix sized as its own PR (it changes a signature, its sole caller,
> ~15 assertions, the **FE twin**, and a response DTO).
> **2b (stages)** waits for a real canonical guard and a wireframe collapsing five status fields to at
> most two. **2c (pack station)** is blocked on the § 6D ADR and a security review.


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

### Wave 3 — Orchestration (rules engine **cut**; two named features instead)

**A stress test cut the rules engine from the plan of record.** The plan's own warning — *"parity on
triggers you cannot emit is not parity"* — turned out to indict it.

17. **SLA escalation as a core feature.** One sweeper job type; per-connection thresholds in
    `connection.config`; **notification only, no outbound marketplace write**. Note this reintroduces
    the clock writer D13 declined for the *projection* — deliberately, and confined to a sweeper that
    notifies rather than a column anything derives from.
18. **Cancel propagation** — already delivered by Wave 1's `order_relay_attempts` + sweep. Not a rule.
19. **Auto-advance on pack completion** — already in § 6C. Not a rule.

That is the whole of Wave 3's novel content: **one cron and one notifier.**

#### Why the engine was cut

- **Its differentiator was already deleted.** Item 13 previously read "dry-run … reuses the changeset
  replay" — and ADR-040 **deferred the replay function**. The sole § 8 test of the sole differentiator
  tested a component the design had removed. Dry-run did not survive the move out of ADR-040; only
  the word did.
- **The evaluation context is I/O.** A realistic rule ("unshipped 48h after payment, Allegro
  connection, all lines in stock, stage = To pack") needs 6–8 reads. The AST is pure only because
  something else loads everything first — so the condition vocabulary is bounded by the loader, not
  the AST, and preview-at-T differs from apply-at-T+1 unless the evaluated snapshot is persisted.
- **D13 contradicted D5 two decisions apart.** D13 excludes SLA from the projection because it
  consumes a wall clock; Wave 3 made SLA the headline rule subject.
- **The headline rule had no trigger.** D13 explicitly refuses a clock writer, so nothing emits
  "SLA breached".
- **The trigger surface is one stream.** OL has **three** event streams today — one has no consumer,
  two carry nothing an operator would rule on. After Wave 2 there is one useful stream carrying ≤6
  cause types. Of BaseLinker's ten trigger categories OL can serve **one**; five it cannot serve at
  all. `sync_jobs` lifecycle is column writes with no hook, and there is no in-process emitter.
- **The loop cap is unimplementable as named.** § 12 requires a causation-depth cap for "rule loops
  through marketplace round-trips" — but no correlation id survives the outbound boundary
  (`order-ingestion.service.ts` states plainly that no `correlationId` exists), and D15 has no `rule`
  `causeType`. The mitigation and the hazard are disjoint.
- **The precedent already exists.** `AutoIssueTriggerService` is a shipped "when paid or shipped →
  issue invoice" orchestration: ~150 lines of core service plus a four-value config enum, with
  idempotency and PII-safe errors. It needed no engine.

#### Deferred behind a falsifiable premise

Mirroring [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md):
**revisit when a second customer requests a third automation that config cannot express.** Until then
it does not exist.

**Preconditions if it returns** — not follow-ups:

1. A `rule` `causeType` in D15, and an **attribution-free per-`(order, rule)` firing budget** in a
   rolling window, replacing the unbuildable causation cap.
2. A durable **firings table** before any delayed action — the idempotency key has no correct shape
   without one (`rule:{ruleId}:{orderId}` can never fire twice; a nonce duplicates on every retry
   wave). Cost is four tables, not two.
3. **Rule version pinned at schedule time.** Otherwise editing a rule silently rewrites thousands of
   in-flight delayed actions — the exact principle ADR-041 adopted as a precondition.
4. Explicit `priority` with documented conflict resolution. Silence means the implementer picks
   last-writer-wins, which is what generates Linnworks' "my rule didn't work" support article.
5. `ReferenceExists`-style refusal on deleting a stage, connection or action a rule references —
   the same dangling-reference defect that cut the flow entity.
6. A **sized** fan-out ceiling with named breach behaviour.
7. **Rules must not fire on backfilled or replayed transitions.** Wave 2 item 16 backfills by writing
   ledger events; without this rule, a backfill emits thousands of transitions and the engine chases
   every one at the marketplace. This is a scheduled day-one incident, not a hypothetical.
8. A **cancel/reschedule primitive** for `sync_jobs` — today there is only
   `requeueDeadByIdempotencyKey`, so a stale delayed action cannot be withdrawn, only no-opped at
   resume while remaining indistinguishable from live work in job diagnostics.
9. **Policy stays in `connection.config`; rules may only act.** § 6E's "later expressible as a rule"
   would otherwise recreate the two-places-no-precedence defect § 6E exists to fix.
10. **Capability-gate outcomes are first-class log entries.** A silently-skipped action whose
    condition passed makes "why didn't my rule fire" answer the wrong question confidently.

### Wave 4 — Post-sale (**narrowed to a projection** after a stress test)

The original Wave 4 proposed two tables, a six-value lifecycle enum and a bespoke reason vocabulary
on top of a marketplace surface that is **read + one rejection** on Allegro and a **read-only
embedded array with no id and no status** on Erli. A stress test rejected it on the same grounds that
cut ADR-040's action machinery and ADR-041's flow entity: entity ahead of requirement.

**What ships:**

15. **`order_returns_projection`** — refreshed from the source snapshot on poll. Columns:
    `internalOrderId`, `platform`, `externalReturnId | null`, **`rawStatus` (verbatim source
    string)**, `lines: jsonb` of `{ externalItemRef, quantity, reasonRaw, resolvedOrderLineId | null }`,
    `rawPayload`. No lifecycle enum, no `ReturnLine` table, no reason vocabulary.

    This **closes open question 6a in favour of verbatim projection.** Decomposing Allegro's
    11-value "timeline" into facets means OL interprets four interleaved axes with no operator asking
    for a report from the result.
16. **One action: reject-refund**, routed through the existing ADR-040 `order_changes` proposal
    record. It is exactly "a single action against a single reference" — the shape ADR-040 says is the
    whole of OL's mutation surface. **Zero new tables.**

**Why the rest was cut — each for a verified, not speculative, reason:**

- **A `Return.status` enum has one derivable value.** Of `requested | approved | received | closed |
  declined | cancelled`, only `declined` maps to something OL observes (the one write). Allegro has no
  create, so `requested` is not a state OL sees entered; **nothing in the surface produces
  `approved`** — not-yet-rejected is not approval; `closed` maps to `FINISHED`, which means
  *settlement*. An operator filtering "approved" gets zero rows forever, or rows OL fabricated.
- **`damagedQuantity` is unobservable from every source in scope.** Neither platform reports
  condition. It could only ever be operator-typed, in OL, on a screen Wave 4 would also have to build,
  for a restock write that does not execute. And grading returned goods is **warehouse mechanics — a
  declared permanent non-goal in § 1**.
- **Erli breaks the aggregate's primary key.** No return id, read-only embedded array re-read every
  poll, no ordering guarantee — so `Return.id` is a synthesised surrogate over an unstable natural
  key, and `Return.status` is `unknown` for 100% of Erli rows. Persisting a mirror of a read-only
  array is the anti-pattern the projection avoids.

**Relocated or blocked, not deferred:**

- **Step 0 (exhaustiveness) moves to Wave 2.** Five two-branch `if/else` consumers of
  `OrderLifecycleEventType` that "compile cleanly and mis-route at runtime" is a **live latent bug**
  independent of returns. Add the `never` defaults *without* adding a union member.
- **Item 18 (`+= 'returned'`) is withdrawn until a target adapter can name a value it would write.**
  Allegro's `RETURNED` requires all items returned *and* refunded — nothing to write for a partial
  return, and OL cannot assert the refund half. Erli's `PATCH /orders/{id}/status` has no line
  parameter. Every adapter would answer `unsupported`.
- **Item 19 (`CorrectionIssuer` mapper) is BLOCKED, not deferred.** The ambiguity is on *both* sides.
  `InvoiceLine` is `{ name, quantity, unitPriceGross, taxRate }` — **no line id, no sku, no
  productId** — and `toInvoiceLine` collapses identity to `name?.trim() || sku || productId`. So two
  order lines for the same offer produce **byte-identical snapshot lines**, and
  `CorrectionLine.originalLineNumber` is *positional* into that snapshot. The ambiguity is benign only
  while unit prices match; with a line-level promo the correction is silently wrong by the price
  delta — on a **KSeF-transmitted legal document whose issue date is authority-assigned and therefore
  not retractable (D8)**. (Second positional hazard: the mapper *conditionally* appends a shipping
  line, so the index space shifts when shipping is zero.)

  **Precondition: a stable line reference on `InvoiceLine` / `issuedLineSnapshot`.** That is an
  invoicing-domain change, not a Wave 4 line item. Until then the operator issues the correction
  manually, with the ambiguous case **shown rather than resolved**.
- **Item 20 (restock) is not a returns feature.** `PrestashopInventoryMasterAdapter.adjustInventory`
  **rejects** (`PrestashopNotSupportedException`, "not supported in MVP"); WooCommerce's own comment
  admits a non-atomic read-modify-write race. And the OL-side shortcut is closed by **D7** — the
  quantity column is a master mirror, rewritten every sync, so there is nothing durable to increment
  until Wave 5's first OL-owned column. Its true content is "implement `adjustInventory` on
  PrestaShop": a PrestaShop-integration issue, needing no `Return` aggregate to justify it.
- **Item 21 (disputes) is deleted from the delivery list.** `PostPurchaseIssueStatus` (read) and
  `ClaimStatusChangeRequest` (write) are **different enums**, so the write is not the inverse of the
  read; and an issue references `offer { id, quantity }` — **offer-scoped, one offer per issue** — so
  it is not order-grained and does not fit under a return aggregate at all. Open question 3 is still
  open; an unanswered open question must not appear as a numbered work item.
- **Item 22 collapses to one nullable observed field**, documented as inferred. `CustomerReturn.refund`
  is a bank account with **no amount and no status**, so "intent" would have no source amount — OL
  would invent the claimed figure and compare it to an execution it also inferred. Two layers, zero
  measurements, is a discrepancy generator. (The BaseLinker/Medusa/Saleor precedent is from systems
  that process the payment.)

**The § 9 gate was also decorative and is replaced.** "The read-only Allegro surface is the binding
constraint" locates the constraint on *Allegro's* side, which no amount of OL modelling relieves — it
argues for a better read, not an OL-owned write model. The honest one-line summary is: *returns are
surfaced read-only on order detail; OL owns no return state, because on both platforms in scope it
observes one.*

### Source-shape constraints the projection must absorb

These survive the narrowing — they are constraints on the *source mapper*, which exists either way.

- **Allegro's return `status` is not a state machine.** Its 11 values interleave four axes —
  logistics (`DISPATCHED`/`IN_TRANSIT`/`DELIVERED`), settlement (`FINISHED`/`FINISHED_APT`),
  commission (`COMMISSION_REFUND_CLAIMED`/`COMMISSION_REFUNDED`) and fulfilment-warehouse
  (`WAREHOUSE_*`). The spec itself calls it a *"timeline"*. Carried **verbatim** as `rawStatus`.
- **Erli returns have no status at all** — a fact, not a workflow, embedded read-only on
  `Order.returns[]` with no return id and no reject action.
- **Two adapter traps, both verified in the specs.** Erli's quantity field is misspelled
  **`quentity`** — an adapter reading `quantity` silently gets `undefined`. And its line reference is
  a **positional `index` into `Order.items[]`**, not an id, despite `items[].id` existing; resolve
  `index → items[index].externalId` at ingest and persist the resolved id, never the index.
- **Allegro's `CustomerReturnItem` carries `offerId`, not the checkout-form line id** — so attribution
  to an ordered line is a **best-effort resolution that may be ambiguous** (one checkout form can hold
  two lines for the same offer). `resolvedOrderLineId` is nullable by design; an unresolvable
  attribution is operator-facing, never a silent guess.
- **Allegro customer-returns is `[BETA]`** (`application/vnd.allegro.beta.v1+json`), and its only
  write is the rejection. Read + reject is the whole surface — this is what caps Wave 4's ambition.

### Wave 5 — Allocation (**cut as scoped** after a stress test)

**The headline fix does not apply to the default routing case.** § 6 C3a resolves the C3 feedback loop
by closing a reservation on OL's own dispatch event. But `FulfillmentRoutingService` defaults to
**`omp_fulfilled`** (`processorConnectionId` is null for it — "no rule"), where the OMP ships and OL
only *reads status back*. § 6K already says the gate "binds only where OL dispatches"; C3a never
carried that across.

On the plan's own reference topology (PrestaShop master + Allegro source) the OMP that fulfils **is
the master**: PrestaShop decrements its own stock, the next `MasterInventorySyncService` poll writes
the lower `availableQuantity`, and `olReservedQuantity` is still held because no dispatch event
reaches OL. Published stock becomes `master − olReserved − buffer` with `master` already reduced — a
seller with 3 units and a buffer of 1 **publishes 0 after selling 1**, for the whole reservation TTL.
The expiry sweeper becomes the *normal* close path, which § 6I explicitly forbids.

That makes the feature **worse than shipping nothing in its default configuration.**

Three further defects, each independently disqualifying as scoped:

- **Reserve-on-ingestion is unimplementable at the point item 25 names.** `OrderIngestionService`
  resolves item refs one at a time and, on any failure, persists `awaiting_mapping | source_deleted`
  and **throws so the runner retries**. So there is no variant to reserve against for exactly the
  orders in the oversell window; and `source_deleted` hits § 6I's `WHERE "isStale" = false` → zero
  rows → a **permanent domain rejection of a real, paid order**.
- **The retry loop double-reserves.** The partial unique index keys on `orderLineId`, and
  `prestashop-order.mapper.ts:53` builds it as `String(row.id || index)`. If that value differs
  between retries — index fallback, re-ordering, or the `||` bug on `row.id === 0` — the idempotency
  key differs and the same line reserves twice. **Open question 6c is not "harmless today"**; it is a
  live oversell bug on a code path that retries by design.
- **The reconciler entrenches the drift that matters.** It is ledger-authoritative, so it fixes
  counter drift and *confirms* ledger wrongness: a release that fails **before** the ledger write, a
  double-reserve, or a consume that never fires all leave the ledger wrong and the correction rate at
  **zero**. The proposed "non-zero correction rate is a defect signal" alert reads **green during the
  incident it was built for.**

**Also corrected:** ATP has **seven** consumers, not six — the seventh is
`erli-order-source.adapter.ts:634`, **outside core**. A migration list assembled from an incomplete
grep, for a change whose entire justification (C2) is that the wrong answer produces zero compile
errors, is the failure C2 describes. Only the FE consumer is compile-protected.

**And item 23 is a one-line no-op hiding a cross-context refactor.** `applyStockSafetyBuffer` is a
pure two-argument function; the change lives at its **three call sites**, two of which
(`offer-builder`, `product-publish-builder`) apply it to a caller-supplied `input.stock` re-hydrated
from a **retry snapshot**. Making them consume ATP means changing stock provenance several layers up,
or adding an inventory read inside a builder — a new `listings → inventory` runtime dependency at the
point the codebase currently keeps pure.

### What ships instead

**Keep `stockSafetyBuffer`.** It already ships as the mitigation for precisely this risk, across all
three publish paths, with a misconfiguration warning. Wave 5 replaces one tunable integer with a
table, a counter with a CHECK, a partial unique index over an unstable line id, a lock-ordering rule,
a raw-SQL transaction in a READ COMMITTED codebase, a sweeper, a reconciler with a false-green alert,
a publish-pipeline refactor, seven consumer migrations and a published-contract removal.

Two items are cheap, independently valuable, and unblock any future wave:

21. **Make `InventoryRepository.upsert`'s existing-row write explicitly column-scoped** (§ 6I). It is
    column-scoped today only as an emergent property of TypeORM's `save()` diffing — too thin a basis
    for an oversell guarantee. **This is a live latent bug and should not wait for a gate.**
22. **Fix open question 6c now** — the PrestaShop `String(row.id || index)` line id is already unsafe
    for `shipment_lines` in Wave 2, independent of reservations.

**Dropped in every scenario:** removing `reserveInventory` / `releaseInventory` from
`InventoryMasterPort` (old item 27). It buys deleting two spec blocks and editing three docs, while
inverting a promise the WooCommerce operator guide makes and shipping a published-contract change with
no deprecation cycle. `docs/capabilities.md:29` already calls the surface "largely dormant" —
**deprecate in place.**

**Multi-location is latent but unguarded.** Verified: WooCommerce hardcodes `locationId: undefined`,
PrestaShop ignores `_locationId`, and `inventory.service.ts` skips non-default locations. But
`inventory_items.locationId` is nullable with partial unique indexes over it, and
`findAvailabilityByVariantIds` **SUMs across every row for a variant with no location filter**. The
day an adapter emits a non-null location, ATP sums N rows while a reserve `UPDATE … WHERE id = $1`
takes one. A note in a document is not a mechanism: the minimum honest version **rejects at reserve
time if a variant resolves to more than one non-stale row, loudly.**

### The gate criterion was wrong, and is replaced

§ 9 gated Wave 5 on "an actual oversell". That is trippable by a misconfiguration the codebase already
warns about. The premise must be: **an oversell on a connection with a correctly configured non-zero
`stockSafetyBuffer`** — i.e. the existing mitigation demonstrably failing.

**If Wave 5 is revisited, it opens with the close-event question for `omp_fulfilled`, not with the
concurrency mechanism.** If the answer is "there is no close event, only the sweeper", then
reservations cannot feed published stock at all, and the wave becomes a much smaller thing: an
operator-visible allocation view that does **not** touch `applyStockSafetyBuffer`. That version may be
worth building. The version above is not.

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
the free-floating integers D2a forbids).

**Two counters are CUT** (`return_requested_quantity`, `return_received_quantity`), and
`written_off_quantity` with them. They derived from `ReturnLine`, which no longer exists — Wave 4
narrowed to a projection. They cannot be rescued from `order_returns_projection`, because
`resolvedOrderLineId` is **nullable by design** (Allegro's `CustomerReturnItem` carries `offerId`, not
the line id), and "received" has **no observation on either platform** — it is warehouse mechanics, a
declared § 1 non-goal. Under D2a they would be exactly the free-floating integers D2a forbids.

**Wave 2a ships three counters: `ordered`, `shipped_quantity`, `delivered_quantity`.**
`packed_quantity` moves to 2c with the pack station. No counter is
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

> **CORRECTED — the original text here was a security hole.** It said the endpoint allowlist "is the
> security boundary" and that a station token "reaches nothing else". **Both are false against the
> actual guard stack.** `RolesGuard.canActivate` returns **`true`** when a route carries no `@Roles()`
> decorator, and it is a global `APP_GUARD`. So the moment a station principal is placed on
> `req.user` by anything satisfying `JwtAuthGuard`, it is authorized on **every undecorated route** —
> including the customers controller (buyer PII), products, inventory, webhooks and cursors.
>
> **The invariant that must be specified and pinned: a station principal never appears on
> `req.user`.** The station path is `@Public()` plus its own dedicated verifier, exactly the split
> `mcp-transport.controller.ts` uses and `mcp-tokens.controller.ts` documents ("keeping the two auth
> models in separate controllers"). § 6D previously said "copy the `mcp_tokens` pattern" but described
> only its **storage** half; the load-bearing half is the auth-model separation.
>
> Two further hazards this section never named:
> - **Shared credential at a shared bench.** A bearer token in a bench browser's storage is readable
>   by anyone at the bench. The compensating control — "per-order actor resolved by PIN or badge" — is
>   a **new credential type** with enrolment, rotation, lockout and a brute-force surface (4-digit
>   PINs), none of which exists in `libs/core/src/users` and none of which is scoped here.
> - **CSRF.** `CsrfGuard` is double-submit tied to the `ol_csrf` cookie set at login. A bearer-token
>   station has no such cookie, so every station mutation must be explicitly outside the CSRF path,
>   and that exclusion pinned.

Copy the `mcp_tokens` *pattern* (opaque prefix + SHA-256 at rest + revoke + `lastUsedAt`) into a
sibling table — **do not** extend MCP scopes; `McpTokenService` hardcodes its prefix, scope union and
RFC 8707 `resource`. Note `mcp_tokens.expiresAt` is **non-nullable by design**: a
"never expires" station token contradicts that invariant, so station tokens carry a finite expiry and
a renewal flow.

**This warrants its own ADR and a security review before implementation.**

### 6E. Dispatch gate

**See § 6K — the gate is `connection.config.dispatchGate` (`off | warn | block`), one half of the
validated pack-policy pair.** It supersedes the earlier `requirePackVerification` boolean, which was
defined here *and* per-flow in an earlier draft with no precedence rule between them.

Enforced at label generation, naming the unpacked lines — and therefore **binding only where OL
performs the dispatch**. For `ompFulfilled` (the default routing resolution) and `sourceBrokered`, OL
generates no label and only observes the remote dispatch, so the gate is advisory and must be
labelled as such. Later expressible as a rule.

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

### 6H. Sequencing — ~~Wave 2 can precede Wave 0~~ (**claim withdrawn**)

> **The claim is false, though not for the reason § 6H examines.** The counters genuinely do not
> depend on the axis ledger — that part checks out. But § 5 item 16, the *adopted* form of D17, says
> the backfill **must write ledger events, not counters**, because "written as counters the
> double-count is permanent" for cancel-and-reissue pairs. The ledger is Wave 0. So a fast-pathed
> Wave 2 has nowhere to write the backfill and takes the one irreversible cost the grain decision
> named as its non-negotiable adoption condition. § 6H lists four costs of the fast path and this is
> not among them.
>
> Wave 2a avoids the problem only because it ships **no backfill** — the counters start from the
> first post-migration shipment. That limitation must be stated to the operator, not discovered.

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

**C2 — ATP must be a new field, not a redefinition (D11).** *(Wave 5 is cut; C2 stands as the reason any future redefinition is unsafe — and note the consumer list was itself assembled from an incomplete grep, which is the failure C2 describes.)* Changing `totalAvailable` to mean ATP
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

## 6I. Reservation mechanism — D7/D9 resolved (**retained as reference; Wave 5 is cut**)

> **Status.** A stress test cut Wave 5 as scoped (§ 5). This section is kept because the mechanism
> below is correct *as a mechanism* and would be the starting point if the wave returns — but it is
> **not a delivery plan**, and it is the clearest instance of the disease this plan keeps finding:
> worked out to the SQL, the deadlock ordering and the rejected alternatives, while the two questions
> that decide whether it does anything useful — *what event closes a reservation under
> `omp_fulfilled`* and *what happens to an order that cannot resolve its variants* — got one sentence
> and zero respectively.
>
> If revisited, **open with the close-event question, not with the concurrency mechanism**, and treat
> the single-location guard below as a required `CHECK`, not a note.

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

## 6K. Pack policy — adapting to different warehouse processes

**D18 / [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md).**
Different clients work differently. **A stress test rejected the named-`OrderFlow` entity** that
originally sat here; what ships is the two axes with a real requirement, and stages stay **global**.

### The config pair

Two keys on `Connection.config` (JSONB, no migration — the `stockSafetyBuffer` / `pricingRule`
precedent), read by one pure coercer and **validated together**, because they are the one genuinely
dependent pair:

| Key | Values |
|---|---|
| `verificationMode` | `manual` · `scan` · `scan-where-possible` |
| `dispatchGate` | `off` · `warn` · `block` |

§ 6E's `requirePackVerification` is **superseded by `dispatchGate`** — one enforcement point, one
source of truth. (The earlier draft defined the gate twice, per-connection *and* per-flow, with no
precedence rule.)

### `scan-where-possible`, and why it needs a timestamp

Scan verification resolves a barcode against `ProductVariant.ean`; a variant without one cannot be
scanned. Under `scan-where-possible`, a line **carrying an EAN must be scanned**; a line without one
may be ticked, and the UI distinguishes them.

But `ean` is mutable — the master sync can populate it later. An order ticked on Monday would become
"a line that carried an EAN was not scanned" on Tuesday, on any recompute or audit query. So
`order_pack_events` records **`scannableAtPackTime`**, mirroring why § 6B denormalises `sku`/`ean`/
`name` onto `order_record_items`. Verification is judged against what was knowable when it happened.

### The gate binds only where OL dispatches

`FulfillmentRoutingService` resolves `processorKind`, and its **default is `ompFulfilled`** — OL
generates no label. For `ompFulfilled` and `sourceBrokered`, dispatch happens remotely and OL only
observes it, so `block` is **unenforceable**.

Verification is therefore **advisory** on those routes, and **the UI must say so**. A gate that
claims to block and silently does not is worse than no gate. This constraint is why `dispatchGate`
cannot be validated in isolation from routing.

### Deferred, with preconditions

`order_flows`, `OrderFlowResolver`, `order_records.flowId`, `packGrain`, `packingSlip`,
`disabledGuards` and `orderType` are deferred to the § 9 Wave-2 checkpoint, where the premise —
several clients working measurably differently — is either observed or is not.

Why each was cut:

- **`packGrain` is not a policy value.** The containment claim ("flow is a pure input to
  `resolveFlowPolicy(flow, line, order)`") is disproved by its own signature: a multi-order batch has
  no singular `order`. Batch packing needs a different screen, an ambiguity-resolution algorithm (one
  scanned EAN matching lines on three orders), and a batch entity with claim/release semantics.
- **The guard allowlist duplicated the axes.** `requireScanVerification` disabled ≡
  `verificationMode: manual`; and `packingSlip: none` with `requirePackingSlipPrinted` enabled is
  representable and means wait-forever.
- **`orderType` has no referent** — zero occurrences in `libs/core/src`. It was Fluent's vocabulary
  imported without an OL meaning, leaving the resolver key undecidable.

**If it returns, these are preconditions rather than follow-ups** — from how the platforms that
actually ship configurable workflows handle config evolution:

1. **Version it, and snapshot the resolved definition onto the order.** Fluent increments a workflow
   version on commit and pins in-flight instances to the version they started on; Temporal's whole
   versioning discipline exists to guarantee the same invariant. For a config this small the snapshot
   is cheaper than retaining historical definitions, and it removes the dangling-order problem too.
2. **Refuse destructive edits.** commercetools blocks deleting a referenced State (`ReferenceExists`)
   and tells implementers to migrate first; Camunda requires an explicit mapping for every active
   element and **rejects the whole migration** if one is missing.
3. **Stamp the selection key at creation.** Every surveyed platform does; none re-evaluates mid-order.

The outcome every platform avoids, by different means, is the one the first draft would have
produced: **an order sitting in a status the config no longer contains.**

## 7. Extensibility model

Three layers, with deliberately different answers. The decision that must be made **now** is layer 2.

### Layer 1 — Operator customisation (open, and the point)

Operator-defined stages and per-connection `config` policy (§ 6K). This is the BaseLinker-parity
axis — narrower than an earlier draft claimed, since the rules engine that carried most of it was
cut (§ 5 Wave 3).

### Layer 2 — Plugin extensibility: **actions yes, states no**

**Decision: the canonical state axis stays core-owned; plugins may contribute *actions*.**

The prior art splits exactly on tenancy. Every hosted platform (Saleor, Shopify, Medusa) keeps state
core-owned and lets third parties contribute only actions and data. Every self-hosted one (Vendure,
Sylius, Spree) opened the state axis and then spent years managing it — Sylius retrofitted mandatory
callback priorities, Solidus has standing RFCs about state-machine overriding. A plugin-added state
is a permanent widening of every downstream `switch`.

Decisive: **you can open the state axis later; you cannot close it.**

Three boundaries copied from prior art:

- **Plugins supply actions, never conditions** (Shopify Flow's boundary). The predicate language stays
  core-owned. Note the earlier draft said "triggers **and** actions" — but § 7's own minimum change
  adds only an *action* registry, `HostServices` has no event-publishing seam, and a plugin-supplied
  trigger would determine the evaluation context's shape, which kills purity as surely as a plugin
  condition would. The boundary was drawn on the wrong axis; actions are the whole of it.
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
| Pack-policy pair validation | unit, per invalid combination | the pair is validated together; an invalid combination must be rejected at connection save, not at the bench |
| `scan-where-possible` | unit: mixed order, some lines with EAN, some without | EAN lines must require a scan; only unscannable lines accept a tick |
| **`scannableAtPackTime`** | int-spec: tick an EAN-less line, then populate the EAN via the master sync, then re-read | verification must stay valid — this is the retroactive-instability defect |
| **Gate on a non-OL-dispatch route** | int-spec: `dispatchGate: block` on an `ompFulfilled` order | must not claim to block; the advisory path must be explicit in the response, not silently degraded |
| SLA escalation sweeper | int-spec: threshold crossed, threshold not crossed, already-escalated | the whole of Wave 3's new behaviour; notification only, must never write outbound |
| Counter validation ladder | unit, one case per rung | each rung has an operator-readable message |
| Pack-event idempotency (`clientEventId`) | int-spec — duplicate insert | unique-constraint behaviour |
| Wave 4 Step 0 exhaustiveness | compile-time (`never` default) + unit per adapter | the point is that the compiler starts catching it |
| Station auth | int-spec + security review | new bearer-token surface |

New tables must be added to `tablesToTruncate` in the integration harness.

---

## 9. Checkpoint

**Treat the end of Wave 2 as a real gate.** At that point the Orders workspace and pack station
exist, and the foundation is paid for by the bug it fixed.

"Fresh justification" was too weak to fail — a gate with no criterion is decorative. Each deferred
item now carries a **falsifiable premise**, and the gate is simply whether it has been observed:

| Deferred | Premise that must be observed |
|---|---|
| Rules engine (§ 5 Wave 3) | a **second** customer requests a **third** automation that config cannot express |
| `OrderFlow` entity (ADR-041) | **several clients working measurably differently** — not one client with two preferences |
| Reservations / allocation (Wave 5) | an oversell **on a connection with a correctly configured non-zero `stockSafetyBuffer`** — i.e. the existing mitigation demonstrably failing |
| Returns beyond the projection (Wave 4) | an operator **acting** on returns often enough that read-only surfacing is what blocks them — and, for the correction mapper, a stable line reference existing on `InvoiceLine` |

None of these is a judgement call about value; each is a thing that either happened or did not. If
none has been observed at the gate, the correct outcome is to ship nothing further and say so.

**Two gates were rewritten because they were decorative.** Wave 5's original premise ("an actual
oversell") is trippable by a misconfiguration the codebase already warns about, so it could fire
without the existing mitigation ever having been tried. Wave 4's ("the read-only Allegro surface is
the binding constraint") located the constraint on *Allegro's* side, where no OL modelling reaches —
it argued for a better read, which the projection now delivers. A premise that the gated work cannot
satisfy is falsifiability costume, not a gate.

---

## 10. ADRs

| # | Subject | State |
|---|---|---|
| [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) | Canonical lifecycle as a derived projection over a fact ledger | Proposed |
| [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) | Proposal record for remote-authority mutations (composition machinery deferred) | Accepted |
| [ADR-041](../architecture/adrs/041-order-flows-as-named-operator-process-configuration.md) | Pack policy as a validated per-connection config pair; flow entity deferred | Proposed |
| — | `order_axis_transitions` as a third dedup layer (vs ADR-005, ADR-007) | to write |
| — | Ledger-as-outbox vs fire-after-commit | to write |
| — | ~~`OrderAuthorityResolver`~~ | **not written — closed by scope** |
| — | Self-echo posture: origin exclusion + outbound write records | to write |
| — | `connections.orderAuthority` (Posture A/B) | to write |
| — | **Late / out-of-order event policy** — no prior art in any surveyed platform | to write |
| — | Pack-station authentication | to write (before Wave 2 6D) |
| — | ~~Rules engine: AST + capability-gated actions + purity constraint~~ — **not needed**; the engine is cut (§ 5 Wave 3) | withdrawn |
| — | Returns as a child aggregate | to write |
| — | ADR-028 amendment | to write |

**`OrderAuthorityResolver` — CLOSED BY SCOPE, not by design (2026-08-14).**

The placement question below is moot: **the resolver is not built.** A deployment uses OL's order
workbench **or** an external OMS, never both in parallel — a product constraint, not a runtime
reconciliation problem. There is no precedence to resolve, no merge semantics, no per-axis authority
role.

Two supporting findings from the analysis that closed it:

- **The tempting precedent does not transfer.** WooCommerce's inventory write-back is mutually
  exclusive with `InventoryMaster` *per connection* — but that is two **capabilities on one
  connection**, both adapter-served and resolved through `getCapabilityAdapter`. OL's own OMS is not
  a connection capability; there is no connection to hang an exclusivity on. Copying the shape would
  be cargo-culting a precedent whose mechanism does not apply.
- **No enforcement is warranted, because the fact has no dependent behaviour.** `packedAt` (#2072) is
  advisory operator metadata; nothing reads it to make a decision, since the dispatch gate was cut
  with Wave 2. Two writers cannot corrupt anything. Building a guard here would be mechanism ahead of
  requirement — the disease all eight stress tests found.

**Precondition, recorded rather than built:** if a future feature makes an OL-owned fulfilment fact
*gate* something (a dispatch block, an auto-status transition, an SLA calculation), authority becomes
load-bearing and exclusivity must be designed **before** that feature ships. The natural enforcement
point is then configuration-time, following BaseLinker's one real authority primitive — an API-only
warehouse, i.e. exclusive ownership — not runtime arbitration, which BaseLinker never built for
orders and which no surveyed platform offers.

**Also relevant to the external-OMS posture:** integrating an external OMS needs *no new port*. It is
an ordinary fulfilling destination — `OrderProcessorManagerPort.createOrder` +
`FulfillmentStatusReader` + `OrderFulfillmentUpdater` / `OrderStatusWriteback`, routed `omp_fulfilled`
per [ADR-012](../architecture/adrs/012-branch-1-fulfillment-modeling.md) — which is exactly what
PrestaShop and WooCommerce already do. Ingesting *from* one is the mirror (`OrderSourcePort`). The
market norm is that a product picks one posture (ChannelEngine = connector with a fixed state
machine; Linnworks = lifecycle owner); OL supporting both is unusual and should be treated as a
deliberate strategic position rather than an incidental capability.

~~*Superseded placement note:*~~ `orders ↔ mappings` is already a package-level cycle, tolerated
because the `mappings → orders` half is `import type` only. Placing a resolver in `mappings` would
pass the lint guard only if type-only plus `I*Service` + token; `orders.module.ts:32` already imports
`MappingsModule`, so a value import back would need `forwardRef`. Retained only in case the
precondition above ever fires.

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
- Fan-out amplification: 5k orders × actions against marketplace quota. **The #2019 limiter does not
  mitigate this** — an earlier draft claimed it did. `MAX_TOTAL_WAIT_MS = 120_000` and `acquire()`
  **throws** past it, so under amplification the limiter converts fan-out into mass job failure,
  retries and a growing dead pile that then re-drives. Pacing is not capping
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
