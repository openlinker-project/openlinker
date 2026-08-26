/**
 * Reservation Ledger Types (#2343, ADR-061 decision 1)
 *
 * The vocabulary of OpenLinker's own advisory reservation ledger: an
 * OL-recorded, time-boxed claim on available-to-promise that never decrements
 * the master's stock, only what OL is willing to promise.
 *
 * `ReservationAtpEffect` deliberately lives elsewhere — it shipped with the
 * read half (#2321) on `reservation-ledger-reader.port.ts` and is re-exported
 * here rather than redeclared, so the column has exactly one vocabulary.
 *
 * @module libs/core/src/inventory/domain/types
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 * @see docs/plans/analysis/ANALYSIS-1032-oms-module.md § 6I
 */
import type { ReservationAtpEffect } from '../ports/reservation-ledger-reader.port';
// Type-only, so no runtime cycle exists even though the entity imports this
// module back for its own field types.
import type { Reservation } from '../entities/reservation.entity';

export type { ReservationAtpEffect };

/**
 * Lifecycle of one reservation row.
 *
 * Only `held` is live. The three terminal values are kept distinct rather than
 * collapsed into one `closed` — an operator asking why stock came back needs to
 * know whether the order was cancelled (`released`), shipped (`consumed`), or
 * simply timed out (`expired`), and #2349's sweep behaves differently for each.
 *
 * A terminal row is never deleted; consumers filter on `status`, never on row
 * existence.
 */
export const ReservationStatusValues = ['held', 'released', 'consumed', 'expired'] as const;

export type ReservationStatus = (typeof ReservationStatusValues)[number];

/**
 * The subset of {@link ReservationStatusValues} a live reservation may move TO.
 *
 * A narrowed union rather than a runtime guard: `releaseHeld` takes its terminal
 * status as data (§ 6I — "release and consume decrement identically"), and this
 * type is what makes "flip it back to held" fail at compile time instead of
 * corrupting the counter.
 */
export const ReservationTerminalStatusValues = ['released', 'consumed', 'expired'] as const;

export type ReservationTerminalStatus = (typeof ReservationTerminalStatusValues)[number];

/**
 * The natural key of a live reservation.
 *
 * **`orderRecordId` is not optional and cannot be dropped** (§ 6I). `orderLineId`
 * is the *source-supplied* `OrderItem.id`, unique only within its own order —
 * Allegro and PrestaShop line ids collide across orders trivially. Keyed on
 * `orderLineId` alone, order B's reserve would fail against order A's unrelated
 * held row and the operator would read "insufficient stock" with stock plainly
 * available.
 */
export interface ReservationKey {
  readonly orderRecordId: string;
  readonly orderLineId: string;
  readonly inventoryItemId: string;
}

/**
 * One line's intent: "after this call, this line should hold exactly
 * `quantity` units of this position."
 *
 * Note `quantity` is the DESIRED total, not a delta. The repository computes the
 * delta against whatever is persisted, which is what makes a repeated identical
 * claim a no-op and an amended line a delta-adjust — both without the caller
 * having to read first (and therefore without a read-then-act race).
 *
 * `atpEffect` and `expiresAt` apply only when the row is newly inserted:
 * `atpEffect` is immutable per reservation by ADR-061 decision 1, and extending
 * an expiry is #2349's state-dependent sweep, not a side effect of re-reserving.
 */
export interface ReservationClaimInput extends ReservationKey {
  /** Desired held quantity. Must be > 0; a zero-unit hold is meaningless. */
  readonly quantity: number;
  readonly atpEffect: ReservationAtpEffect;
  readonly expiresAt: Date;
}

/**
 * What one claim actually did, so a caller can distinguish "granted, nothing
 * moved" from "granted, took 3 more units" without a second read.
 */
export interface ReservationClaimOutcome {
  readonly reservation: Reservation;
  /** Units held before this call — `0` when the row was newly inserted. */
  readonly previousQuantity: number;
  /** `quantity - previousQuantity`. Zero for an idempotent repeat. */
  readonly deltaApplied: number;
  /**
   * `availableQuantity - olReservedQuantity` after the counter moved, straight
   * from the guarded statement's `RETURNING`. `null` when `deltaApplied === 0`,
   * because no counter statement ran and inventing a value would mean reading
   * the row again for a figure nobody asked for.
   */
  readonly remainingAtp: number | null;
}

export interface ReleaseReservationInput extends ReservationKey {
  readonly terminalStatus: ReservationTerminalStatus;
}

/**
 * Why a position could not accept a claim at all — as opposed to accepting it in
 * principle but lacking the units.
 */
/**
 * One extension of a live hold's expiry (#2346).
 *
 * Carries the new instant rather than a duration: the sweep resolves the TTL
 * once per run from `readReservationTtlMs`, so every hold extended in one run
 * moves to the same instant and two runs cannot disagree about "now".
 */
export interface ExtendReservationExpiryInput extends ReservationKey {
  readonly expiresAt: Date;
}

export const ReservationPositionUnavailableReasonValues = ['missing', 'stale'] as const;

export type ReservationPositionUnavailableReason =
  (typeof ReservationPositionUnavailableReasonValues)[number];
