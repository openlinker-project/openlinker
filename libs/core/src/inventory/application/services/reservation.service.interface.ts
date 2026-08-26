/**
 * Reservation Service Interface (#2344, ADR-061 decision 1)
 *
 * The order-shaped seam over the advisory reservation ledger: *"after this call,
 * these order lines should hold exactly these quantities."*
 *
 * Four contract properties a caller must know, because getting any of them wrong
 * produces an oversell rather than an error:
 *
 * 1. **Get-or-create, never reject-on-retry.** A repeated reserve for the same
 *    `(order, line, position)` is a SUCCESS with `deltaApplied: 0`, which is what
 *    makes an ingestion crash after the claim resumable instead of wedging the
 *    order behind a false "insufficient stock" (design § 4.2 amendment 2).
 * 2. **`quantity` is the DESIRED TOTAL, never a delta.** An amended line
 *    delta-adjusts under the same guarded UPDATE — never release-then-reserve.
 * 3. **`atpEffect` and `expiresAt` are honoured only on INSERT.** Both are
 *    immutable per reservation; re-reserving never re-stamps either, and
 *    extending an expiry is #2346's state-dependent sweep.
 * 4. **The check IS the reserve.** Never read availability and then call this —
 *    an unlocked read-then-act is the defect shape ANALYSIS-1032 § 6I replaces.
 *
 * Release, consume and expire land on this same interface with their own issues:
 * #2346 (state-dependent expiry sweep), #2347 (consume as a
 * `Shipment.reservationConsumedAt` claim), #2348 (the ADR-028 cancellation
 * restore). The repository already exposes `releaseHeld` and
 * `listHeldByOrderRecordId` for them.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link ReservationService} for the implementation
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import type {
  ReserveForOrderInput,
  ReserveForOrderResult,
} from '../types/reservation-service.types';

export interface IReservationService {
  /**
   * Hold inventory for an order's lines — all of them, in one transaction.
   *
   * Every claimable line is passed to the repository in ONE call, because the
   * sort-by-`inventoryItemId` deadlock guarantee, the single transaction and the
   * all-or-nothing rollback are all properties of that one call (§ 6I). A caller
   * must not loop this method per line.
   *
   * Lines that are correctly NOT held are reported on `skipped` rather than
   * raised: a variant with no live position, and a line whose reservation was
   * already released / consumed / expired (which must never be resurrected — the
   * idempotency index is partial on `status = 'held'`, so a terminal row does not
   * block a fresh insert).
   *
   * @throws {AmbiguousReservationPositionError} one or more lines resolved to
   *   several live positions with no explicit `inventoryItemId`. Raised ONCE,
   *   naming every ambiguous line, before anything is written — so a caller that
   *   degrades by dropping those lines needs a single retry, never a loop.
   * @throws {InsufficientAvailabilityError} a position is live but has fewer
   *   units left than a widening asked for. The whole call rolls back.
   * @throws {ReservationPositionUnavailableError} a position does not exist or
   *   is `isStale`.
   * @throws {RangeError} a line quantity is not a positive integer — raised
   *   before any storage access.
   */
  reserveForOrder(input: ReserveForOrderInput): Promise<ReserveForOrderResult>;
}
