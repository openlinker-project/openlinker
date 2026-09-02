/**
 * Reservation Ledger Reader Port (#2321, ADR-061 decision 1)
 *
 * The read half of OpenLinker's own advisory reservation ledger: how many units
 * of a variant are currently claimed by OL-recorded holds that reduce
 * available-to-promise.
 *
 * The ledger itself is Wave 2 — no table exists yet, and the only shipped
 * implementation is {@link EmptyReservationLedgerReader}, which returns nothing.
 * The port ships now anyway, and that is deliberate: with the term present but
 * empty, the computed path's arithmetic is byte-identical to today's published
 * quantities, so Wave 2 becomes *swapping one provider binding* rather than
 * changing a formula that four publish sites already depend on.
 *
 * @module libs/core/src/inventory/domain/ports
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import type { AvailabilityScope } from '../types/availability.types';

/**
 * Which reservations reduce ATP (ADR-061 decision 1).
 *
 * Stamped on the row **at creation** by the ingestion caller that holds the
 * routing outcome — never inferred at read time, so no cross-context read
 * exists on the ATP path and the Wave-5 double-subtraction cannot recur.
 *
 * - `'published'` — the hold reduces the quantity OL publishes. Written only for
 *   orders OL itself executes.
 * - `'diagnostic'` — recorded for visibility, subtracted from nothing.
 */
export const ReservationAtpEffectValues = ['published', 'diagnostic'] as const;

export type ReservationAtpEffect = (typeof ReservationAtpEffectValues)[number];

export interface SumReservedInput {
  readonly variantIds: readonly string[];
  readonly scope: AvailabilityScope;
  /**
   * Which stamp to sum. **Required, never defaulted** — a default here would be
   * a policy decision hidden in a signature, and the wrong default silently
   * subtracts diagnostic holds from a real published quantity.
   */
  readonly atpEffect: ReservationAtpEffect;
}

export interface ReservationLedgerReaderPort {
  /**
   * Sum live reservations per variant for one scope and one `atpEffect` stamp.
   *
   * Returns entries ONLY for variants with a non-zero sum — an absent key means
   * zero, which is the same convention the availability repository read uses,
   * so the caller zero-fills once.
   */
  sumReservedByVariantIds(input: SumReservedInput): Promise<ReadonlyMap<string, number>>;
}
