# Implementation Plan: Cancellation — release the ledger, then restore ATP (#2348)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: On order cancellation, OpenLinker must produce **exactly one** ATP increase, of the
right size, in one order: the order's held reservations are **released first** (which is what lowers
`olReservedQuantity` and therefore raises ATP), and only then does the ADR-028 marketplace stock
restore publish the recomputed number outward. A cancellation of an order whose goods already
shipped must **not** restore at all.

**Context**: ADR-028's cancellation restore predates the ledger (#2343-#2347). #2323 already
repointed the restore's *number* onto `IInventoryQueryService.getAvailabilityByVariantIds`'s
`availableToPromise`, and left a comment saying "the release is upstream of this call today". That
comment is **false**: nothing in the tree releases a cancelled order's reservations. `releaseHeld`
has exactly two callers — `ReservationExpiryService` and `ReservationService.consumeForOrder`. So
today a cancelled order's holds stand until the expiry sweep reaches them (and under #2346 that
sweep *extends* rather than releases while the order is live), and the restore publishes an ATP that
is still net of the cancelled order's own hold — i.e. it under-restores by exactly the cancelled
quantity, permanently.

**Classification**: CORE (Application layer). No migration.

---

## 2. Scope & Non-Goals

### In Scope
- Generalise the order-scoped ledger close on `IReservationService` so the terminal status is a
  parameter (`consumed | released`), per §6I's "terminal status is data".
- Release a cancelled order's held reservations, unconditionally and first.
- Skip the restore for an order that already consumed (`Shipment.reservationConsumedAt IS NOT NULL`).
- Make the ordering structural, not conventional, and pin it with a test.
- Make every non-restoring exit observable.

### Out of Scope
- Any change to how ATP is computed (#2345 owns the formula).
- Reservation shortfall (#2349) and its FE surface (#2350).
- Reconciling the cancelled-after-dispatch contradiction — it is *displayed* (story L6), not fixed.
- A `SyncLock` around the cancellation sequence: the job type is already deduped per order
  (`marketplace:{connectionId}:stockRestore:{internalOrderId}`), and every step below is idempotent.

### Constraints
- `inventory` must never import `shipping` (the back-edge `ShippingModule → InventoryModule` exists).
- The `publish-quantity-parity` int-spec must stay byte-identical green.
- Migration slot 1861000000000 is reserved for this body but **is not expected to be used**.

---

## 3. Architecture Mapping

**Target layer**: CORE / Application, in two contexts.

| Context | Change |
|---|---|
| `inventory` | `IReservationService.consumeForOrder` → `closeForOrder({orderRecordId, terminalStatus})`. |
| `shipping` | `IShipmentQueryService.hasConsumedReservations(orderId)` — a read over `findByOrderId`. |
| `listings` | `OfferStockRestoreService` becomes the ordered cancellation sequence. |

**New cross-context edge**: `listings → shipping`, via `IShipmentQueryService` +
`SHIPMENT_QUERY_SERVICE_TOKEN` only — both allowed shapes under
`architecture-overview.md § Cross-context dependencies in core`. It is **acyclic**: no core module
imports `ListingsModule`, and `ShippingModule` does not import it either, so
`ListingsModule → ShippingModule` adds one forward edge and no DI cycle. Verified by reading every
`libs/core/src/*/​*.module.ts` for a `ListingsModule` / `ShippingModule` import (none).

**Why `listings` and not `inventory`**: the predicate is a *shipping* fact, and `inventory` may not
import `shipping`. `orders` has no `inventory` edge today. `listings` already imports `inventory`
and `orders`, already owns the ADR-028 restore, and is the single service the one cancellation job
reaches — so it is the only place where the two steps can be made one method without inverting an
existing dependency direction.

**Why not `releaseForOrder`**: a twin method invites a copy-paste of the consume body and a second
place where "which terminal status" is decided. §6I already made terminal status data at the
repository (`releaseHeld({..., terminalStatus})`); the service now says the same thing.

---

## 4. Research

- `ReservationRepositoryPort.releaseHeld` is guarded on `status = 'held'`, raising
  `ReservationNotHeldError` when the row already left. That guard is the exactly-once primitive.
- The ATP read (#2345) filters `status = 'held'`, so a terminal status removes the row from the
  subtraction immediately — release is a *real* ATP transition, not bookkeeping.
- `atpEffect` is insert-only and `published` is stamped only where OL executes fulfillment; on a
  default install every hold is `diagnostic`, so an integration test asserting an ATP change must
  stamp `published` explicitly.
- `OrderIngestionService` enqueues `marketplace.offer.stockRestore` on **every** `→ cancelled`
  transition, regardless of marketplace — so the job is a reliable place to hang the release.
- `OfferStockRestoreService` currently **short-circuits first** on "connection has no
  `OfferStockRestorer`" (the common case — Allegro restores its own stock). Anything placed after
  that guard would never run for most connections.

---

## 5. Questions & Assumptions

- **Assumption**: an order with several shipments counts as consumed if *any* shipment carries
  `reservationConsumedAt`. Partial dispatch is not modelled; the conservative reading (do not
  restore) is the one that cannot oversell.
- **Assumption**: releasing on cancellation is correct even for an order that never held (no live
  position, reservations disabled) — that is an all-zero result, not a warning.
- **Known boundary, carried forward from #2347**: a hold created *between* the consume read and the
  claim (an order amended after dispatch to add a line) is closed by neither pass. Cancellation now
  closes it, because the release here is unconditional and does not consult the marker.

---

## 6. Implementation Plan

### Phase 1 — inventory: terminal status as a service parameter

1. **`application/types/reservation-service.types.ts`**
   - Rename `ConsumeForOrderInput/Result` → `CloseForOrderInput/Result`; add
     `readonly terminalStatus: 'consumed' | 'released'` to the input and rename the `consumed`
     counter to `closed`.
   - *Acceptance*: type-check passes; no `ConsumeForOrder*` identifier remains.

2. **`reservation.service.interface.ts` / `reservation.service.ts`**
   - `consumeForOrder` → `closeForOrder`, threading `input.terminalStatus` into `releaseHeld`.
     Everything else (per-row failure counting, `ReservationNotHeldError` → `alreadyTerminal`,
     empty-set all-zero) is unchanged.
   - Docblock states both callers and why one method: the ledger cannot tell the two apart, and a
     twin would give "which status" two homes.
   - Rewrite the interface's file-header block (`reservation.service.interface.ts:24-26`), which
     still lists #2348 as future work on this interface — the issue that ships it must not leave the
     docblock describing an unshipped state.
   - Export `CloseForOrderInput` / `CloseForOrderResult` from `libs/core/src/inventory/index.ts`.
   - *Acceptance*: `reservation.service.spec.ts` updated; a spec asserts `releaseHeld` receives the
     caller's terminal status verbatim for both values.

3. **`shipment-reservation-consume.service.ts`** — call `closeForOrder({..., terminalStatus:
   'consumed'})`. No behavioural change. *Acceptance*: its spec stays green with the rename only.

### Phase 2 — shipping: the consumed predicate

4. **`shipment-repository.port.ts`** — no change (`findByOrderId` suffices).
5. **`shipment-query.service.interface.ts` / `.service.ts`** — add
   `hasConsumedReservations(orderId: string): Promise<boolean>`, documented as *"did this order's
   goods leave the building, per the durable `Shipment.reservationConsumedAt` claim"* — a durable
   fact, never an inference from reservation status. Its docblock records that folding over
   `findByOrderId` is DELIBERATE at today's shipments-per-order cardinality, so a later reader does
   not "optimise" it into a repository `EXISTS` without noticing that costs a port change.
   - *Acceptance*: unit spec covers none / one-unconsumed / one-consumed / mixed.

### Phase 3 — listings: one ordered method

6. **`offer-stock-restore.service.ts`** — `restoreStockForCancelledOrder` becomes:

   ```
   1. RELEASE  — closeForOrder({orderRecordId, terminalStatus: 'released'})  ← unconditional, first
   2. GUARD    — hasConsumedReservations(orderId) ? log + return : continue
   3. RESTORE  — the existing #2323 body, moved verbatim into a private method
   ```

   - **Structural ordering**: the restore body becomes `private async publishRestoredAtp(release:
     CloseForOrderResult, …)` — the release's own return value is threaded in as the first
     parameter. It is obtainable ONLY by calling the release, so moving the restore above it fails
     to compile, not merely a test. No synthetic brand: `CloseForOrderResult` already means "the
     release ran" and already carries the counters the failure gate and the log line need, so a
     bespoke witness type beside it would be an abstraction with no information in it.
     `CloseForOrderInput` / `CloseForOrderResult` become barrel exports of
     `@openlinker/core/inventory`, which is honest now that a sibling context consumes them.
   - **Release is before the `OfferStockRestorer` short-circuit**, not after: most connections have
     no restorer, and a ledger leak on every Allegro cancellation is exactly the defect this closes.
   - **A failed release skips the restore AND FAILS THE JOB.** `closeForOrder` tolerates per-row
     failures by counting them — and that tolerance belongs there, inside the ledger close, where
     one bad row must not abort the rest of the order. It does **not** belong at this orchestration
     seam: "some holds are still live" is precisely the state that must not be recorded as done.
     Publishing an ATP still net of holds we failed to release would under-restore a live offer, so
     the restore is skipped; but returning `{ outcome: 'ok' }` from the handler would end the job
     forever (`SyncJobRunner` retries only a job that FAILED), and unlike #1689's pause there is no
     `stockRestoreSweep` reconcile task to heal it — the offer would sit at its pre-cancellation
     quantity permanently with a healthy-looking job log. So a non-zero `failed` logs at `error` and
     **throws**; `MarketplaceOfferStockRestoreHandler` wraps it into `SyncJobExecutionError` and the
     ordinary retry ladder re-runs the whole idempotent sequence.
   - **Every non-restoring exit is observable**: the consumed-after-dispatch skip and the
     failed-release skip log at `log`/`error` with `{orderId, connectionId}`; the pre-existing
     "connection has no restorer" / "no variants" / "no mapping" exits stay at `debug` (they fire on
     every cancellation platform-wide, and promoting them would be an alarm on a healthy install).
   - **`provenance: 'unknown'` still omits, never zeroes** — the existing `quantity === undefined`
     omission is retained and gains an explicit spec, since a `0` would trip #1689's stale-offer
     pause and deactivate a live offer.
   - **The method returns an outcome, not `void`**: `{ released, alreadyTerminal, outcome:
     'restored' | 'skipped-consumed' | 'skipped-no-restorer' | 'skipped-no-targets' }`, mirroring
     `ConsumeShipmentReservationsResult` on this same branch. The issue requires every non-restoring
     exit to be observable, and a `Promise<void>` lets the handler log only "executed", never what
     happened; the handler logs the outcome with job context.
   - *Acceptance*: the spec asserts release-before-restore by call order on a shared mock recorder,
     asserts no restore when the marker is set, and asserts release still runs when no restorer
     exists.

7. **`listings.module.ts`** — import `ShippingModule`; comment records the direction and that
   `shipping` must never import `listings` back.

8. **Docs** — `architecture-overview.md § 6 Listings` (restore ordering + the new edge) and
   `§ Cross-context dependencies in core` (add `listings --> shipping` to the mermaid map).

### Phase 4 — integration test

9. **`apps/api/test/integration/…/cancellation-release-then-restore.int-spec.ts`** — seed a position
   + a `published` reservation, read ATP, cancel, assert exactly one ATP increase of the reserved
   size and that the reservation row is `released`. A second run of the same job asserts ATP does
   not move again (the restore is an absolute set; the release is a guarded no-op).

---

## 7. Alternatives Considered

- **Release in the worker handler, restore in the service.** Rejected: the ordering would live in a
  handler's statement order, which is exactly the convention-not-code shape the issue forbids, and a
  second handler could later call the restore alone.
- **A new `OrderCancellationInventoryService` in `inventory`.** Rejected: it needs the shipment
  marker, and `inventory → shipping` is the forbidden direction.
- **Infer "already consumed" from the ledger** (no held rows). Rejected: `listHeldByOrderRecordId`
  returns only held rows, so consumed, expired and never-reserved are indistinguishable — the
  durable marker is the only honest predicate.
- **Restore anyway after dispatch** (the ATP is arithmetically correct there). Rejected by the
  issue's own assumption: the contradiction is displayed, not reconciled.

---

## 8. Risks

- **Rename churn** across #2347's freshly-landed consume path. Mitigated: mechanical, compiler-checked.
- **New module edge** could reintroduce a cycle later. Mitigated: comment + the existing
  `check-cross-context-imports` gate, which allows only `I*Service` / token shapes.
- **Crash-kill safety** (see §9).

---

## 9. Crash-kill reasoning (not merely throw-safety)

The sequence has **no claim marker of its own**, and that is deliberate. #2347 flipped to
consume-then-claim because a claim-first pass compensates a throw but not a `SIGKILL`. Here the
same reasoning is taken one step further: there is nothing to claim.

- **Killed after release, before restore** — the job never reaches `succeeded`, so stuck-job
  recovery requeues it. The re-run's release finds no `held` rows (the guarded UPDATE already moved
  them), decrements nothing, and reports `alreadyTerminal`; the restore then runs against the *same*
  ATP the first run would have published. Converges.
- **Killed after restore, before the job completes** — the re-run repeats an **absolute set** to the
  currently-computed ATP. Absolute, not delta, is what makes a repeat a no-op; nothing double-counts.
- **Killed mid-release, between two rows** — each `releaseHeld` is its own guarded UPDATE, so the
  ledger is consistent at every instant; the re-run closes the remainder.
- **Ordering cannot invert under a kill** because the release is not a *step that records that it
  happened*; the terminal status **is** the record, and it is the same fact the ATP read consults.
  A restore that runs is therefore necessarily reading a ledger from which this order's holds are
  already gone — including across a process boundary.

The one thing a kill can leave is a *missing* restore (release done, marketplace not yet written).
That is the safe direction: the offer is under-published, never over-published, and the next run of
the same job fixes it.

---

## 10. Alignment Checklist

- [x] Hexagonal layering respected; no repository port crosses a context.
- [x] CORE-only; no adapter or plugin contract changes.
- [x] Idempotency: guarded UPDATE + absolute-set restore.
- [x] No `any`, no `console.log`, no migration, no `synchronize: true`.
- [x] Naming + file structure per engineering-standards.
- [x] Tests: unit (3 services) + one integration slice.
