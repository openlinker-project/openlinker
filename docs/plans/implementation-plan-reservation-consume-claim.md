# Implementation Plan: Reservation consume as a `Shipment.reservationConsumedAt` claim (#2347)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: when a shipment is dispatched, the order's `held` reservations must move to
`consumed` — exactly once — and `inventory_items.olReservedQuantity` must come down by the
same amount. `availableQuantity` must not move at all.

**Context** (REVIEW § 3 C8): `ShipmentDispatchService` **short-circuits** on an already-active
shipment — it returns the peer's shipment from the contended branch and from
`findActiveByOrderId` without re-running the dispatch body. That early return is the same one
that made #1947's waybill relay necessary. Hanging "consume the reservation" off the dispatch
call therefore loses the consume on any retry, and the hold sits `held` until the expiry sweep
— which, per #2346's fail-closed posture, extends rather than releases. ATP is understated for
as long as that lasts.

**Classification**: CORE (Infrastructure + Application) + Worker. **Migration-bearing.**

---

## 2. Scope & Non-Goals

### In scope
- `shipments.reservationConsumedAt` column + migration (**slot `1854000000000`**).
- Conditional claim / release on `ShipmentRepositoryPort`, and a candidate read.
- `IReservationService.consumeForOrder` — the ledger-side write, terminal status `'consumed'`.
- `ShipmentReservationConsumeService` — the orchestrating pass, in `shipping`.
- Worker handler `inventory.reservations.consume` + scheduler task + lane registration.

### Out of scope
- Per-shipment-line consume (see § 5, Assumption A1 — not expressible today).
- Restoring on cancellation (#2348) and shortfall detection (#2349).
- Any change to `availableQuantity`, to `atpEffect`, or to the ATP formula.

---

## 3. Architecture Mapping

**Target layers**: `libs/core/src/shipping` (claim + orchestration),
`libs/core/src/inventory` (ledger write), `apps/worker` (handler + schedule).

**Direction of the new edge — `shipping → inventory`, and only that direction.**
`ShippingModule` imports `InventoryModule` and injects `RESERVATION_SERVICE_TOKEN`.
`inventory` gains **no** knowledge of shipping. This is acyclic by construction and needs no
port-inversion ceremony:

- Shipping already imports `orders`, `mappings`, `integrations`, `identifier-mapping`, `sync`.
- Nothing in `libs/core` imports `ShippingModule` (its own module header records this).

**Alternative rejected** — putting the pass in `inventory` behind an inverted
`ConsumableFulfillmentPort` implemented by shipping (the `ObligationReaders` shape #2346 uses).
That indirection exists in #2346 because the *obligation source does not exist yet* and the
mapped type is what forces a future kind to be implemented. Here both sides exist today, the
call is one concrete read plus one concrete write, and inverting would add a port, a token, a
factory binding and a fake for no property gained. The seam #2346 needed is not the seam this
needs.

**Cross-context contract**: `shipping` imports only `IReservationService` +
`RESERVATION_SERVICE_TOKEN` from `@openlinker/core/inventory` — a service interface and a
Symbol token, both explicitly allowed shapes (architecture-overview § Cross-context
dependencies). Repository ports stay intra-context and are imported **relatively**.

---

## 4. Domain Research

### The claim-marker precedent (#1947), which this follows verbatim
`Shipment.waybillRelayedAt` exists because conflating the *data* (`trackingNumber`) with the
*claim* forced a choice between re-driving a non-idempotent POST every tick and losing the
number permanently. `reservationConsumedAt` is the identical shape one concern over:
`ShipmentRepository.claimWaybillRelay` is `update({ id, waybillRelayedAt: IsNull() }, …)` and
answers `affected > 0`; `releaseWaybillRelay` nulls it on the failure path.

### The ledger's terminal-status-as-data contract (#2343/#2346)
`ReservationRepositoryPort.releaseHeld` takes `terminalStatus` as **data** precisely so that
release / consume / expire do not become three near-identical `WHERE` clauses that drift apart.
Consume therefore adds **no repository method** — it passes `'consumed'`.
`listHeldByOrderRecordId` already exists and its docblock already names #2347 as a caller.

### Two guards, two different jobs — and the ordering that follows from it
The ledger's own guard (`status = 'held'`) is what makes the **decrement** exactly-once: a
double `releaseHeld` raises `ReservationNotHeldError` rather than double-decrementing. The
marker's job is different and narrower — it stops the pass **re-examining** a shipment forever.

**Therefore the pass consumes FIRST and claims SECOND.** This is the one ordering decision in
the slice and it is a correctness property, not a style choice:

- **Claim-then-consume is unsafe.** A *throw* between the two can be compensated (release the
  claim), but a **process kill** cannot: no catch runs, the marker stays set, the shipment leaves
  the candidate set permanently, and its reservations stay `held` forever. That is understated
  ATP with no self-healing path and no operator signal — the exact defect this issue exists to
  close, reintroduced one layer up. #1947 tolerates that window because its cost is one missed
  notification; here the cost is stock that can never be resold.
- **Consume-then-claim converges.** A kill between the two leaves the shipment a candidate; the
  next tick re-runs `consumeForOrder`, finds zero `held` rows, decrements nothing, and claims.
- **Double-consume stays structurally impossible**, because the ledger — not the marker — was
  always the decrement guard. Two concurrent sweeps both call `consumeForOrder`; the row-level
  guarded UPDATE lets exactly one win and the loser raises `ReservationNotHeldError`.

The redundant-work argument for claiming first is negligible: the handler already holds a global
`SyncLockPort` lock, so concurrent runs occur only on lock-TTL expiry.

**Consequence: there is no `releaseReservationConsume`.** The claim is only ever taken *after*
the work succeeded, so nothing can hold a claim it needs to give back. Shipping a dead method for
symmetry with `releaseWaybillRelay` would violate "build only the surface the current product
needs" (`engineering-standards.md § MVP Primitives Standard`).

### Frontier-as-query, not scan-offset
Same reasoning as #2346, restated because it is a correctness property rather than a style
choice: a successful consume **removes its own row from the candidate set** (the marker is no
longer NULL). An offset advancing over a self-consuming set steps over shipments silently —
here that means a hold that is never consumed and ATP that is understated forever. So the
predicate is the cursor; there is no cursor column and no `MasterSweepKind` member.

---

## 5. Questions & Assumptions

- **A1 — consume is ORDER-scoped, not shipment-line-scoped.** The issue assumes "a partially
  shipped order consumes the reservations for the lines on that shipment only". **`Shipment`
  carries no line composition** — `shipments` has `orderId`, carrier, status, tracking and
  nothing per-item, and neither `CreateShipmentInput` nor the dispatch seam threads lines. So
  per-line consume is not merely unimplemented, it is *unexpressible* against today's schema.
  The pass consumes every `held` reservation on the shipment's order and says so in its own
  docblock. This is stated as a deviation rather than silently approximated: on a partially
  shipped order it consumes slightly early (the un-shipped lines' holds also close), which
  releases ATP the operator can still sell — the same direction a cancellation would take it,
  and strictly safer than the alternative of leaving *every* hold open. Per-line consume needs
  shipment lines first; that is not this issue.
- **A2 — candidate statuses are `dispatched`, `in-transit`, `delivered`.** `in-transit` and
  `delivered` both imply a dispatch happened, and a shipment can reach them without the pass
  having caught it at `dispatched`. `draft` / `generated` have not shipped; `cancelled` /
  `failed` must never consume.
- **A3 — a consumed shipment that is later cancelled does not restore.** #2348 § Assumptions
  states this explicitly ("the contradiction is displayed, per story L6, not reconciled").
  Nothing here needs to handle it.
- **A4 — the first cycles are a one-time marker backfill, and that is expected.** On any existing
  install every historical `dispatched` / `in-transit` / `delivered` shipment is initially a
  candidate. Most consume nothing (no ledger rows existed when they shipped), get marked, and
  leave the set forever. At `*/10` × budget-100 that is ~14.4k/day and self-limiting. Stated in
  the handler docblock so the first days' log volume is not mistaken for a defect.
- **A5 — the sweep does NOT read `OL_RESERVATIONS_ENABLED`.** Ingestion gates *creation* on it;
  gating *consumption* too would strand the one asymmetric case — an order reserved while
  enabled, then the flag turned off, then dispatched — leaving a real hold to the expiry sweep,
  which by #2346's fail-closed design extends rather than releases. Consuming unconditionally is
  the safe direction: where no rows are held it is a no-op.

---

## 6. Implementation Plan

### Phase 1 — the claim column

1. **`shipment.orm-entity.ts`** — add `reservationConsumedAt: Date | null`
   (`@Column({ type: 'timestamp', nullable: true })`), directly after `waybillRelayedAt`, with a
   comment pointing at the domain entity. Add a **partial index** on the candidate predicate.
2. **`shipment.entity.ts`** — append `reservationConsumedAt` as the **last** constructor
   parameter, honouring the entity's documented anti-collision rule (trailing slot, type-distinct
   where possible, required with no default so every construction site is forced to supply it).
3. **Migration `apps/api/src/migrations/1854000000000-add-shipment-reservation-consumed-at.ts`**
   — `ADD COLUMN` + `CREATE INDEX`, both `IF [NOT] EXISTS`-guarded; `down()` drops both.
   **Parity is diffed mechanically**, not by eye: the integration harness builds its schema with
   `synchronize`, so any DEFAULT / index name / constraint name / nullability declared on one
   side and not the other fails only under integration (this has cost the wave twice).

### Phase 2 — repository

4. **`shipment-repository.port.ts`** — **two** methods, docblocked:
   - `listDispatchedAwaitingReservationConsume(limit)` — candidate page, `createdAt ASC`.
   - `claimReservationConsume(id, at): Promise<boolean>` — conditional, `affected > 0`.

   The candidate read's docblock must record **why it is not `findMany`**, since
   `ShipmentFilters` already carries the tri-state null-predicate idiom (`hasTracking`,
   `hasProviderShipmentId`) and a reviewer will reasonably ask. Three concrete reasons:
   `findMany` takes an explicit **`offset`** (the scan-offset shape this pass rejects — the
   candidate set consumes itself), orders **`createdAt DESC`** (newest-first would let a
   persistently failing row starve the oldest, the reverse of what is wanted), and runs
   **`findAndCount`** (a COUNT nothing reads, every tick).
5. **`shipment.repository.ts`** — implement, mirroring `claimWaybillRelay` exactly
   (`IsNull()` in the WHERE). **`(result.affected ?? 0) > 0`** — node-postgres returns
   `[rows, affectedCount]` and `[[], 0]` is the silent-oversell shape; the `?? 0` is what keeps
   an `undefined` from coercing to a false claim.

### Phase 3 — the ledger write

6. **`reservation-service.types.ts`** — `ConsumeForOrderInput` / `ConsumeForOrderResult`
   (`consumed`, `alreadyTerminal`, `failed`).
7. **`reservation.service.interface.ts` / `.service.ts`** — `consumeForOrder`:
   `listHeldByOrderRecordId` → per row `releaseHeld({ …key, terminalStatus: 'consumed' })`.
   Per-row `try/catch`, never fatal — the same per-candidate posture `ReservationExpiryService`
   takes, for the same reason.

   **`ReservationNotHeldError` is counted as `alreadyTerminal`, NOT as `failed`.** Under the
   consume-then-claim ordering it is an ordinary, expected race outcome (a peer sweep or a
   cancellation won the row), so folding it into `failed` would make a healthy install report a
   false alarm on every retry. A silent decline is one defect class; a loud false one is
   another. Only an unexpected error counts as `failed`.

   An empty list returns all-zero and is a legitimate outcome (reservations disabled, no mapped
   position, an order that never held) — not a warning.

### Phase 4 — the pass

8. **`shipment-reservation-consume.service.ts`** (+ `.interface.ts`), in `shipping`:
   read a page → per shipment: **`consumeForOrder` first, then claim** (see § Two guards above).
   A throw from either step counts `failed` and leaves the marker NULL, so the next tick retries;
   nothing needs releasing, because the claim is taken only after the work succeeded. A claim
   returning `false` means a peer marked it first — counted as `skipped`, not an error.
   **Every non-consuming exit is counted and named** (`examined`, `consumed`, `skipped`,
   `failed`, plus `reservationsConsumed` and `alreadyTerminal` folded up from the ledger) — a
   silent decline is the defect class this programme keeps closing. A full-page failure logs the
   same starvation warning #2346 introduced, and for the identical structural reason: a
   permanently failing row keeps its NULL marker, stays at the head of the `createdAt ASC`
   ordering and is re-read every tick.
9. **`shipping.module.ts`** — import `InventoryModule`, provide/export the service + token;
   **`shipping.tokens.ts`** — `SHIPMENT_RESERVATION_CONSUME_SERVICE_TOKEN`.

   The module header comments (`:70-71`, `:76`) assert *"nothing imports ShippingModule except
   the host app graph."* That stays true, but the new edge creates a **standing constraint —
   `inventory` must never import `shipping`** — which today holds only by accident. State it
   explicitly in that comment, or a future inventory→shipping import becomes a silent cycle.

### Phase 5 — worker

10. **`sync-job.types.ts`** — `'inventory.reservations.consume'`.
11. **`reservation-consume.handler.ts`** — copy of the expiry handler's shape: own lock key
    (`inventory:reservations:consume:{scopeId}`, **not** `sweepLockKey`, which renders
    `master:{kind}:sweep:{id}` and would name a master this pass does not have), `resolveSweepBudget`
    / `resolveSweepLockTtlMs` reused, no cursor. Global scope under `SYSTEM_CONNECTION_ID`.
12. **`handler-registration.service.ts`** — register on the **`bulk`** lane (bounded local
    writes, no children enqueued, nothing a buyer waits on). This moves the ADR-050 partition
    counts: `bulk` 17 → 18, total 42 → 43. Exact edits, all in
    `__tests__/handler-registration.service.spec.ts`: `L13` comment, `L31` `length: 42`, `L40`
    title (`43 … 13/18/5/7`), `L52` `17`→`18`. **Also fix the already-stale "16 bulk" prose** in
    that spec's header (`L4-10`) and at `handler-registration.service.ts:106`. **The full suite
    is what catches this** — the lane partition spec and the scheduler's no-platform-knowledge
    task list are contract tests that exist precisely to fail on an added task or lane member.
13. **`scheduler.service.ts`** — `reservation-consume-sweep`, `*/10 * * * *`,
    `OL_RESERVATION_CONSUME_SWEEP_ENABLED`, default ON, reusing the `systemConnection` already
    constructed at `:828`. More frequent than expiry's hourly tick because this pass *releases*
    ATP the operator can resell, and lag here is lost sales rather than a safety risk.
    `scheduler.service.spec.ts:270-292` asserts an **exact 15-entry sorted list** — insert
    `reservation-consume-sweep` between `regulatory-status-reconcile` and
    `reservation-expiry-sweep`. `apps/worker/.env.example` documents the var following the
    `L390-401` block format (landing ~`L418`).

---

## 7. Testing Strategy

**Unit**
- `shipment.repository.spec.ts` — claim returns true/false off `affected`; **`[[], 0]` and
  `affected: undefined` both answer `false`** (regression-pinned on this branch, must not regress).
- `reservation.service.spec.ts` — consume passes `terminalStatus: 'consumed'` for every held
  row; a `ReservationNotHeldError` counts `alreadyTerminal` (**not** `failed`) and does not
  throw; empty list is an all-zero no-op.
- `shipment-reservation-consume.service.spec.ts` — **consume precedes claim** (assert call
  order — this is the crash-safety property, so it needs a test that fails if someone "tidies"
  the ordering back); a throwing consume leaves the marker unclaimed so the next tick retries;
  a claim returning `false` counts `skipped`; counters are exact.
- `reservation-consume.handler.spec.ts` — lock skip, budget resolution, failure wraps into
  `SyncJobExecutionError`, lock always released.

**Integration** (`apps/api/test/integration/`)
- **The C8 regression**: dispatch, then *re-run the pass twice* — exactly one consume, one
  `consumed` row per line, `olReservedQuantity` down by exactly the held amount.
- **`availableQuantity` is untouched** — asserted explicitly (AC-3).
- **Two concurrent passes consume once** — both claim in parallel; exactly one wins.
- **The publish-quantity parity int-spec must stay byte-identical green.** It is the proof this
  whole body is safe to deploy on an empty ledger, and this slice must not perturb it. Note the
  branch invariant when writing any ATP assertion: on a default install every hold is
  `diagnostic`, so a test asserting an ATP *change* must stamp `published` explicitly.

---

## 8. Risks

| Risk | Handling |
|---|---|
| Migration/entity drift | Diffed mechanically; parity is only checked under `synchronize` in the integration harness. |
| Consuming a cancelled shipment | `cancelled` / `failed` excluded from the candidate predicate, asserted. |
| Double consume | Structurally impossible: the ledger's `status = 'held'` guarded UPDATE is the decrement gate; the conditional claim (`affected > 0`) additionally stops re-examination. |
| Crash between the two writes | Consume-then-claim converges on the next tick (re-consume is a no-op). The inverse ordering would strand the hold permanently — see § Two guards. |
| Starvation by a permanently failing row | Counted, and warned on a full-page failure (#2346's precedent). |
| Lane/scheduler contract tests | Expected to move; full suite run before commit. |

---

## 9. What #2348 must know

- `consumeForOrder` is the ledger-side sibling of the release #2348 needs; **both go through
  `releaseHeld` with the terminal status as data.** Do not add a `releaseForOrder` twin —
  parameterise the status.
- `Shipment.reservationConsumedAt IS NOT NULL` is the durable, queryable answer to *"did this
  order already consume?"* — that is the predicate #2348's "cancelled-after-dispatch does not
  double-restore" needs, and it is a fact on the shipment, not an inference from reservation
  status.
- Ordering (`releaseHeld` **then** restore) stays #2348's own invariant; nothing here weakens it.
