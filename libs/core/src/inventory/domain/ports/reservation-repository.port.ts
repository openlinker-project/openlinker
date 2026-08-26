/**
 * Reservation Repository Port (#2343, REVIEW § 3 H9)
 *
 * The write half of OpenLinker's advisory reservation ledger — the counterpart
 * to the read-only {@link ReservationLedgerReaderPort} that shipped with #2321.
 *
 * **Every operation here is a concurrency primitive whose failure mode is an
 * oversell.** The contract is therefore stated in terms of guarded conditional
 * UPDATEs (`UPDATE … WHERE <precondition> RETURNING`, `affected > 0` as the
 * answer) rather than reads a caller then acts on: an unlocked read-then-act is
 * precisely the shape ANALYSIS-1032 § 6I exists to replace. A caller must never
 * "check availability, then reserve" — the check IS the reserve.
 *
 * ## The grain
 *
 * One row is one order line's held claim against one inventory position, keyed
 * `(orderRecordId, orderLineId, inventoryItemId)` and unique **only while
 * `status = 'held'`**. Terminal rows are kept, never deleted, so a line can be
 * released and later re-reserved without colliding with its own history.
 *
 * ## Two invariants callers may rely on
 *
 * 1. **`inventory_items.olReservedQuantity` is denormalised over this ledger,
 *    and the ledger is authoritative.** `claimHeld` and `releaseHeld` keep the
 *    two consistent inside one transaction; #2349's reconciler repairs drift
 *    toward the ledger, never the other way.
 * 2. **No TypeORM error escapes.** Every method raises a named domain error
 *    (`docs/engineering-standards.md § Error Handling`).
 *
 * @module libs/core/src/inventory/domain/ports
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 * @see docs/plans/analysis/ANALYSIS-1032-oms-module.md § 6I
 */
import type { Reservation } from '../entities/reservation.entity';
import type {
  ReleaseReservationInput,
  ReservationClaimInput,
  ReservationClaimOutcome,
  ReservationKey,
} from '../types/reservation.types';

export interface ReservationRepositoryPort {
  /**
   * Make each line hold exactly its requested quantity, moving the position
   * counter by the delta — all in **one transaction**.
   *
   * Get-or-create and delta-adjust are one operation rather than a caller-side
   * composition on purpose: keeping the counter consistent with the ledger row
   * is this repository's own invariant, so a caller cannot be in a position to
   * forget the transaction and manufacture the drift #2349 exists to repair.
   *
   * Semantics per claim:
   * - The row is inserted `ON CONFLICT DO NOTHING`. **A conflict is a success**
   *   — an existing `held` row for the same key is a granted reservation, which
   *   is what makes an ingestion crash after `claimHeld` resumable instead of
   *   wedging the order behind a false "insufficient stock" (ADR-061 amendment
   *   2). Same insert-then-recover idiom `IdentifierMappingService` ships.
   * - The counter moves by `quantity − persistedQuantity`. An identical repeat
   *   moves it by zero and touches no row.
   * - A widening runs the guarded add; a narrowing (the source amended the line
   *   down) runs the clamped decrement and can never fail on availability.
   *
   * **Claims are sorted by `inventoryItemId` before any statement is issued.**
   * That is mandatory, not stylistic (§ 6I): two multi-line orders touching the
   * same positions in opposite order deadlock without it.
   *
   * The whole call is all-or-nothing — a later line's refusal rolls back the
   * earlier lines' rows AND their counter increments, so a partially-reserved
   * order can never persist and an amended-up quantity that fails leaves the
   * original held quantity intact.
   *
   * An empty array is a no-op returning `[]` (no transaction opened).
   *
   * @throws {InsufficientAvailabilityError} the position is live but has fewer
   *   units left than the widening asked for.
   * @throws {ReservationPositionUnavailableError} the position does not exist,
   *   or is `isStale` and must not accept new promises.
   * @throws {RangeError} a claim quantity is not a positive integer.
   * @throws {ReservationLedgerConstraintError} a constraint fired that the
   *   guards should have made unreachable — a defect signal.
   */
  claimHeld(claims: readonly ReservationClaimInput[]): Promise<readonly ReservationClaimOutcome[]>;

  /**
   * Move ONE held reservation to a terminal status and give its units back to
   * the position counter, in one transaction.
   *
   * Release, consume and expire are one operation because they decrement
   * identically (§ 6I); the terminal status is data, not three near-identical
   * methods whose `WHERE` clauses could drift apart.
   *
   * The counter decrement is `GREATEST(0, … − q)`: a reconciler may already have
   * corrected the counter, and the `>= 0` CHECK remains the hard floor beneath
   * it. The *authority* for whether anything was held is the ledger row, so that
   * is where the guard sits.
   *
   * @throws {ReservationNotHeldError} no live `held` row for the key — an
   *   already-terminal row or one that never existed. Raised rather than
   *   silently no-op'ing, because a double release that quietly succeeded is how
   *   a counter drifts below the ledger.
   * @throws {ReservationLedgerConstraintError} as above.
   */
  releaseHeld(input: ReleaseReservationInput): Promise<Reservation>;

  /** The live `held` row for one key, or `null`. Never returns a terminal row. */
  findHeld(key: ReservationKey): Promise<Reservation | null>;

  /**
   * Every live `held` row for one order.
   *
   * `releaseHeld` is keyed, so cancelling an order (#2346/#2347) and the expiry
   * sweep (#2349) both have to discover the keys before they can release them.
   */
  listHeldByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]>;

  /**
   * EVERY row for one order, whatever its status — the terminal ones included.
   *
   * Exists for one caller and one question (#2344's `ReservationService`): *is
   * this line still reservable at all?* The idempotency index is partial
   * (`WHERE status = 'held'`), so a `released` / `consumed` / `expired` row is
   * invisible to `ON CONFLICT` and does **not** block a fresh insert. Ingestion
   * re-runs on every re-poll of an order, so without this read a shipped order
   * would mint a brand-new hold on each poll and re-increment the position
   * counter for stock that has already left the building.
   *
   * **This is not the read-then-act the port's header forbids.** That rule is
   * about a QUANTITY — the value the guard must decide on atomically. This read
   * asks a lifecycle question over MONOTONE state: `releaseHeld` guards on
   * `status = 'held'` and nothing returns a terminal row to `held`, so the only
   * race is a concurrent release landing between the read and the claim, whose
   * outcome is identical to the two operations simply happening in the other
   * order. Do not use it to size a claim.
   */
  listByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]>;
}
