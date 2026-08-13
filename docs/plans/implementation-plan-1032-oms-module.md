# Implementation Plan — #1032 OMS module

**Parent issue:** #1032 (reopened 2026-08-13)
**Spec:** [`docs/specs/product-spec-1032-order-status-state-machine.md`](../specs/product-spec-1032-order-status-state-machine.md)
**Status:** plan of record. Waves are separately gated — see § Checkpoint.

> Supersedes the scoping in #2064 (closed as duplicate of #1032).

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
> authority that may decline it**, plus an **observation** of what that authority did. The data
> model should say so.

Four structural choices follow from that single premise:

| Instead of | Do this | Because |
|---|---|---|
| a stored order-status field | a derived projection over recorded facts | three systems report status; none can own it |
| mutating the order | a changeset: proposed → confirmed/declined | the remote may decline; you need audit + preview |
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
| D4 | Rules engine = hand-rolled **versioned condition AST** + the existing `sync_jobs` scheduler | capability-gating and durable delay are ours regardless; no library contributes to either |
| D5 | **Dry-run is the differentiator**, and nearly free | preview and apply are one replay function. Requires purity: no I/O during evaluation |
| D6 | Returns is a **child aggregate**, not an axis | axis rows are one per order×axis; returns are N per order |
| D7 | Reservations get their **own table**; never overload `inventory_items.reservedQuantity` | that column is a master mirror, rewritten on every sync |
| D8 | Invoice issuance is an **observed** event keyed on the KSeF-returned date | art. 106na — the legal issue date is assigned at transmission |
| D9 | **Invert Medusa's concurrency model**: atomic conditional UPDATE + CHECK constraint | Medusa has zero `FOR UPDATE`, zero CHECK constraints, read-then-write LWW — oversell is genuinely unprevented, and no surveyed OSS platform does better |
| D10 | Lifecycle facts as **independent nullable timestamps**, not one enum | a single flag cannot carry both "did it happen" and "did we relay it" (#1947) |

---

## 3. The core abstraction: the changeset

A change is `PENDING | REQUESTED → CONFIRMED | DECLINED | CANCELED`, carrying
`requested_by` / `confirmed_by` / `declined_reason` and timestamps. Actions are append-only,
`ordering`-sequenced, each with an `applied` boolean. Action types register into an open
`{ validate, operation }` registry rather than a switch. **One replay function produces both the
preview and the applied result.**

Why it fits: dispatch, cancel, return and status-writeback are all proposals to a marketplace.
`applied: boolean` generalises OL's existing at-most-once claims (`waybillRelayedAt`,
`bulk_batch_advancements`). It supplies the audit trail and preview `OrderRecord` lacks.

Two corrections to the reference implementation: enforce "one open change per order" with a
**partial unique index** (OL runs concurrent workers, so an application-code guard is a race), and
**cap the replay window** rather than replaying unbounded history.

See [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) and
[ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md).

---

## 4. Waves

### Wave 0 — Lifecycle foundation (no user-visible change)

Justified independently of the strategic bet: it replaces three ad-hoc at-most-once claims with
one primitive and closes a documented lost-cancel bug (a cancel arriving before the order's create
job runs finds no targets and is silently lost — `order-ingestion.service.ts`).

1. `order-lifecycle-state.types.ts` — axes, ordinals, canonical states, documented precedence
2. `derive-canonical-lifecycle.ts` — pure projection, sibling of `order-sla.ts`
3. Migration: `order_axis_states`, `order_axis_transitions`, `order_records.canonicalState`
4. `OrderAxisLedgerRepository` — conditional-claim + monotonic-UPDATE primitives
5. `OrderLifecycleService` — the sole coordinating writer
6. Re-route the three existing claim sites; delete `isFirst*Transition` **in the same commit**
   (they are today's only at-most-once guarantee; removing them early double-relays)

Idempotency key: `(internalOrderId, axis, originConnectionId, sourceEventId)`. Scoping by
`originConnectionId` is required — external event ids are only connection-unique, which is why
`webhook_deliveries` keys on `(provider, connection_id, event_id)`.

### Wave 1 — Event path + durable relay

7. `events.order.lifecycle` stream + `OrderLifecycleToJobHandler` (clone `MasterDeletionToJobHandler`)
8. **Ledger-as-outbox**: `order_axis_transitions.relayState` (`pending → done | unsupported | failed`)
   plus a `relaySweep`. Master-deletion's fire-after-commit at-most-once is tolerable there because
   `isStale` stays authoritative and an hourly sweep re-reads it; an outbound obligation has no
   re-derivable backing state, so a lost event is a lost notification
9. ADR-028 amendment: cancellation → stock-restore becomes an event consumer
10. Exploit Allegro's `checkoutForm.revision` / 409 CONFLICT for safe status write-back

### Wave 2 — Operator workbench (see § 5)

The wave a warehouse feels. Stage pipeline, per-line counters, pack verification.

### Wave 3 — Orchestration

11. Rules engine over **OL's own event surface** — parity on triggers you cannot emit is not parity
12. Delayed actions via `SyncJobsService.schedule({ runAfter })`; guards re-evaluated **at resume**
13. Dry-run + negative-evaluation logging (reuses the changeset replay)
14. SLA: the product is *managing the dispatch declaration as a risk position*, not showing a number

### Wave 4 — Post-sale

15. `return_requests` + `return_request_lines`; `damaged_quantity` distinct from `received_quantity`
16. Extend `OrderLifecycleEventTypeValues` (today only `dispatched | cancelled`)
17. Return → `CorrectionIssuer` mapper — the capability is already return-shaped
18. Restock — the real gap: nothing writes master inventory upward today
19. Disputes (a richer writable Allegro surface than returns)
20. Plan-vs-execution split for refunds: OL records intent, observes execution

### Wave 5 — Allocation

21. `inventory_reservations` + a shortfall column
22. ATP in `findAvailabilityByVariantIds` — **highest-leverage single change**; six callers benefit free
23. Rewire `applyStockSafetyBuffer` to consume ATP; the buffer becomes a latency cushion
24. Atomic reserve (D9): `UPDATE … SET reserved = reserved + $1 WHERE stocked - reserved >= $1 RETURNING`
    plus `CHECK (reserved_quantity >= 0)`
25. Reserve/release at three existing seams; expiry sweeper
26. Remove `reserveInventory` / `releaseInventory` from `InventoryMasterPort`, or implement honestly

---

## 5. Wave 2 in detail — stage pipeline + pack verification

### 5A. Operator stage pipeline

`order_stages` — operator-defined, seeded with `New → To pack → Packed → Ready to ship → Shipped → Done`.
Columns: `name`, `ordinal`, `canonicalState` (**one-way** map onto the guarded core), `color`,
`isTerminal`, `isActive`.

Placement: `order_records.stageId` + `stageEnteredAt`. A stage is an *operator label*, not an axis —
it never feeds the canonical derivation, or operators could corrupt the guarded core. Moving to a
stage is legal iff the implied canonical transition is legal. `order_stage_history` records
(from, to, actor, at).

### 5B. Per-line counters

`order_record_items` — one row per order line. Identity: `internalOrderId`, `lineId`, `variantId`.
**Denormalised** `sku`, `ean`, `name` so a stale or deleted master variant (#1689) cannot make a
historical order unreadable. Counters: `packed_quantity`, `fulfilled_quantity`, `shipped_quantity`,
`delivered_quantity`, `return_requested_quantity`, `return_received_quantity`, `written_off_quantity`
— plain integers (no `raw_*` doubling; OL owns no money).

Validation ladder, each rung rejecting with an operator-readable message:
`packed ≤ ordered` · `shipped ≤ packed` (when the gate is on) or `≤ ordered` · `delivered ≤ shipped`.

Populated at ingestion from `orderSnapshot.items`; backfill required for open orders.

### 5C. Pack station

`order_pack_events` — append-only, the ledger behind `packed_quantity` (D2a). Columns: `orderId`,
`lineId`, `quantity`, `actorUserId`, `method` (`scan | manual`), `clientEventId` **UNIQUE**,
`createdAt`. The unique client id makes a double-scan idempotent — the real concurrency hazard at a
bench is one packer scanning twice, not two packers.

Barcode resolution uses `ProductVariant.ean`, already populated by the master sync — no new
integration. Four distinct rejection reasons: barcode not on this order · line already fully packed ·
order not in a packable stage · variant is stale.

Completion: when every line satisfies `packed_quantity == quantity`, auto-advance to the configured
packed stage. **Short-pack** is explicitly allowed with a reason, recorded as an exception, and does
*not* auto-advance — without it, one missing item seizes the bench and staff work around the system.

### 5D. Station authentication — the highest-risk item

A pack bench is a shared tablet. Two layers: a long-lived **device session** scoped to warehouse
permissions and packable-stage orders only (no settings, connections or credentials), plus a
**per-order actor** resolved by PIN or badge scan and stamped on each pack event. This touches auth
and warrants its own ADR and a security review.

### 5E. Dispatch gate

`connection.config.requirePackVerification` (JSONB, default `false` — existing setups unchanged),
matching the `stockSafetyBuffer` / `pricingRule` precedent. Enforced at label generation: policy on
and order not fully packed ⇒ refuse, naming the unpacked lines. Once Wave 3 lands, the same gate
becomes expressible as a rule.

### 5F. Permissions

New role `warehouse`: `orders:read` (scoped to packable stages), `pack:write`, `stage:write`.

### 5G. Sequencing — Wave 2 can precede Wave 0

5B + 5C have no hard dependency on the axis ledger. Only the stage pipeline's `canonicalState`
mapping does, and stages can ship bound to the existing derived signals (`fulfillmentState`,
`cancelledAt`) and be re-bound when Wave 0 lands.

- **Fast path:** 5B → 5C → 5A → Wave 0/1 later. Visible value sooner; rework bounded to one mapping column.
- **Foundation first:** Wave 0 → 1 → 2. Cleaner; nothing user-visible for longer.

Recommended: **fast path** — the demand is concrete and the rework is bounded.

---

## 6. ADRs

| # | Subject | State |
|---|---|---|
| [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) | Canonical lifecycle as a derived projection over a fact ledger | drafted |
| [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) | Changeset model for remote-authority mutations | drafted |
| — | `order_axis_transitions` as a third dedup layer (vs ADR-005, ADR-007) | to write |
| — | Ledger-as-outbox vs fire-after-commit | to write |
| — | `OrderAuthorityResolver` — per-(source, axis) coarse roles | to write |
| — | Self-echo posture: origin exclusion + outbound write records | to write |
| — | `connections.orderAuthority` (Posture A/B) | to write |
| — | **Late / out-of-order event policy** — no prior art in any surveyed platform | to write |
| — | Pack-station authentication | to write |
| — | Rules engine: AST, capability-gated actions, purity constraint | to write |
| — | Returns as a child aggregate | to write |
| — | ADR-028 amendment | to write |

---

## 7. Checkpoint

**Treat the end of Wave 2 as a real gate.** At that point the Orders workspace and pack station
exist, and the foundation is paid for by the bug it fixed. Waves 3–5 should each require fresh
justification rather than inheriting today's approval.

---

## 8. Open questions

1. **Open-core / paid module** — raised, undecided. Tension: the best-corroborated PL demand signal
   is pricing flight from the incumbent, and scanning is the cheap half of pack verification. If
   gating, gate hosting / support / agency dashboard / SSO, not warehouse basics. No entitlement
   infrastructure exists today — that is its own build.
2. **Dispatch declaration as a risk position** — `Szybka wysyłka` is max +160 / min 0 but only if
   ≤1 day is declared; `Wysyłka w terminie` runs to −360, and −460 from 26 August. Is helping the
   operator choose and hold a declaration in scope?
3. **Returns ambition** — Allegro permits read + reject-refund only. Is the value in disputes instead?
4. **Legal vs marketplace return state** — when the statutory withdrawal clock and the Allegro return
   disagree, which does the operator's screen show?
5. **COD reconciliation** — a batch-to-line join. Carrier API or bank-statement import? Different products.
6. **Allegro customer-returns status enum** — pull from `swagger.yaml` before Wave 4.
7. **`OrderAuthorityResolver` placement** — `mappings` may create an `orders ↔ mappings` cycle.
8. **Packing slips at the station** — in scope or out?
9. **Variants with no EAN** — manual tick, or scan the SKU?
10. **Batch packing** — out of v1; the standard is to batch the *pick* and single-thread the *pack*.
    Worth confirming with the agency.

---

## 9. Risks

- Guardrails are non-optional and mostly absent; Wave 0 is not skippable
- Station auth is the largest new security surface
- Counter drift if 5B ships without the pack-event ledger (D2a)
- Rule loops through marketplace round-trips need a causation-depth cap
- Fan-out amplification: 5k orders × rules × actions against marketplace quota (#2019 limiter mitigates)
- Delayed-action staleness — no incumbent publishes an answer
- Stale-variant fail-open: rules must respect the #1689 guard
- Backfill of `order_record_items` for open orders
- Value concentrates in later waves while cost is front-loaded — hence § 7

---

## 10. Demand basis (recorded honestly)

A prospective agency asked for an OMS that shows the order, its status, and whether it is packed —
and separately wants orchestration. That fires **#827's** defer condition squarely (it was deferred
for lack of demand, and "is it packed" is its core). It does **not** fire any of #1032's three
un-defer triggers. The reopening of #1032 is therefore a maintainer decision to make the
OMS-positioning bet, consistent with the *STRATEGIC BET* posture recorded at Gate A on 2026-06-18 —
not new evidence that the original triggers fired.
