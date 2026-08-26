/**
 * Shipment Reservation Consume Service Interface (#2347, REVIEW § 3 C8)
 *
 * A shipment that has shipped should stop holding stock. This is the pass that
 * makes that true, and it exists as a SWEEP rather than as a side effect of
 * dispatch for one reason: `ShipmentDispatchService` short-circuits on an
 * already-active shipment — the contended branch and `findActiveByOrderId` both
 * return the peer's shipment without re-running the dispatch body, the same
 * early return that made #1947's waybill relay necessary. Hanging "consume the
 * reservation" off the dispatch call therefore loses it on any retry, and the
 * hold sits `held` until the expiry sweep, which per #2346's fail-closed posture
 * EXTENDS rather than releases. Understated ATP, indefinitely.
 *
 * ## The ordering is the design
 *
 * Each candidate is **consumed first and claimed second**. The marker is not the
 * guard against a double decrement — the ledger's own `status = 'held'`
 * predicate is — so the ordering is free to be chosen for crash-safety, and
 * must be:
 *
 * - **Claim-then-consume strands the hold.** A throw between the two could be
 *   compensated, but a process kill cannot: no catch runs, the marker stays set,
 *   the shipment leaves the candidate set permanently, and its reservations stay
 *   `held` forever. That is the very defect this pass exists to close,
 *   reintroduced one layer up.
 * - **Consume-then-claim converges.** A kill between the two leaves the shipment
 *   a candidate; the next tick re-runs the consume (a no-op against terminal
 *   rows) and claims.
 * - **Double consume stays structurally impossible.** Two concurrent passes both
 *   call `consumeForOrder`; the row-level guarded UPDATE lets exactly one win
 *   and the loser is counted as `alreadyTerminal`.
 *
 * The redundant-work cost of consuming before claiming is negligible: the
 * handler already holds a global `SyncLockPort` lock, so concurrent runs happen
 * only on lock-TTL expiry.
 *
 * ## Consume is ORDER-scoped, and the deviation is stated rather than hidden
 *
 * #2347 assumes a partially shipped order consumes only the lines on that
 * shipment. **`shipments` carries no line composition** — `orderId`, carrier,
 * status, tracking, and nothing per item — so a per-line consume is not merely
 * unimplemented, it is unexpressible against today's schema. This pass closes
 * every held reservation on the shipment's order.
 *
 * On a partially shipped order that consumes slightly early: the un-shipped
 * lines' holds also close, releasing ATP the operator can still sell. That is
 * the same direction a cancellation would take it and strictly safer than the
 * alternative of leaving every hold open until expiry. Per-line consume needs
 * shipment lines first.
 *
 * ## Never touches `availableQuantity`
 *
 * Consume lowers `olReservedQuantity` only. The master owns on-hand stock and
 * reports the decrement itself on its next sync.
 *
 * ## Known boundary: a hold taken AFTER the consume read
 *
 * The marker is claimed once every hold the consume read has gone terminal. A
 * hold created between that read and the claim is therefore not closed by this
 * run — and, the marker now being set, never by a later one either.
 *
 * Re-ingestion cannot produce that shape: `ReservationService.reserveForOrder`
 * skips a line whose reservation is already terminal (`already-closed`), so a
 * re-polled shipped order re-holds nothing. What can is an order **amended
 * after dispatch to add a NEW line**, which reserves fresh against a shipment
 * that has already been marked.
 *
 * Left open deliberately rather than papered over with a re-check loop, which
 * would only narrow the window, not close it. The backstop is the expiry sweep
 * — which, while #2346's fail-closed reader is bound, extends rather than
 * releases, so such a hold persists until an operator resolves the order. If
 * post-dispatch amendment becomes a real workflow, this is the seam that needs
 * revisiting, not the marker.
 *
 * @module libs/core/src/shipping/application/services
 * @see {@link ShipmentReservationConsumeService} for the implementation
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */

export interface ConsumeShipmentReservationsInput {
  /** Candidates examined per run. */
  readonly limit: number;
  /** Clock, injected so a run stamps one instant and tests are deterministic. */
  readonly now?: Date;
}

/**
 * Every exit, counted and named.
 *
 * A silent decline is the defect class this programme keeps closing, so no
 * candidate may leave this pass without landing in exactly one of these
 * counters. `skipped` and `alreadyTerminal` are benign; only `failed` is wrong.
 */
export interface ConsumeShipmentReservationsResult {
  /** Candidates read this run. */
  readonly examined: number;
  /** Shipments whose marker THIS run claimed. */
  readonly consumed: number;
  /** Reservation rows moved `held → consumed`, summed across the page. */
  readonly reservationsConsumed: number;
  /** Reservation rows that had already left `held` — expected, benign. */
  readonly alreadyTerminal: number;
  /** Marker already claimed by a peer between the read and the write. */
  readonly skipped: number;
  /** Candidates that threw. Their markers stay NULL, so the next tick retries. */
  readonly failed: number;
}

export interface IShipmentReservationConsumeService {
  /**
   * Consume one bounded page of shipped-but-unconsumed shipments.
   *
   * The candidate set is a predicate, not an offset — a successfully consumed
   * shipment leaves it permanently — so a failed run skips nothing and the next
   * tick simply re-reads.
   */
  consumeDueShipments(
    input: ConsumeShipmentReservationsInput
  ): Promise<ConsumeShipmentReservationsResult>;
}
