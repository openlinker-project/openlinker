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

/**
 * One located position's claimed units (#3475): the reservation sum for ONE
 * `(location, variant)` pair. Only LOCATED positions appear - a pooled position
 * (`locationId IS NULL`) names no location and a location-keyed consumer cannot
 * place a number against it.
 */
export interface LocatedReservedSum {
  readonly locationId: string;
  readonly productVariantId: string;
  readonly reserved: number;
}

export interface SumReservedByLocationInput {
  readonly variantIds: readonly string[];
  /** Required, never defaulted - same rule as {@link SumReservedInput.atpEffect}. */
  readonly atpEffect: ReservationAtpEffect;
  /**
   * Leave out the holds of ONE order. The fulfilment router needs it: an order's
   * own `published` hold is written BEFORE it is routed (#3480), so counting it
   * against its own stock would make the last unit look promised to the very
   * order being placed.
   */
  readonly excludeOrderRecordId?: string;
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

  /**
   * The same live, non-stale, stamp-scoped sum as {@link sumReservedByVariantIds},
   * partitioned by `(location, variant)` instead of collapsed to the variant.
   *
   * A SEPARATE method rather than a `location` arm of `AvailabilityScope`: that
   * scope deliberately throws (ADR-061), because answering it from a variant-keyed
   * sum would hand a caller a whole-catalogue number dressed up as a location's.
   * This one answers the narrower question the fulfilment router asks - how much
   * of each location's stock is already promised - and nothing else.
   *
   * Entries only for pairs with a non-zero sum; an absent pair means zero.
   */
  sumReservedByLocation(input: SumReservedByLocationInput): Promise<readonly LocatedReservedSum[]>;
}
