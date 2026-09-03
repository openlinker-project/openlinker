/**
 * Ambiguous Reservation Position Error (#2344, ANALYSIS-1032 § 6I)
 *
 * A line's variant resolved to MORE THAN ONE live inventory position and the
 * caller supplied no explicit one, so there is no non-arbitrary way to decide
 * which position the hold should take.
 *
 * This is § 6I's multi-position guard, carried by design § 4.2 as a v2 gate:
 * `findAvailabilityByVariantIds` SUMs across every position for a variant while
 * a reserve `UPDATE … WHERE id = $1` takes exactly ONE. Silently picking a
 * position therefore promises against a total that no single position holds —
 * an oversell with every counter internally consistent, which is the failure
 * mode this gate exists to prevent. Rejecting loudly is the point.
 *
 * **Plural by construction.** The gate collects every ambiguous line in the
 * order and raises once, so a caller that degrades by dropping the offending
 * lines needs a single pass rather than a retry loop.
 *
 * @module libs/core/src/inventory/domain/exceptions
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */

/** One line that could not be resolved to a single position. */
export interface AmbiguousReservationPosition {
  readonly orderLineId: string;
  readonly productId: string;
  readonly productVariantId: string | null;
  /** Every live position the line's variant resolved to. */
  readonly candidateInventoryItemIds: readonly string[];
}

export class AmbiguousReservationPositionError extends Error {
  constructor(public readonly ambiguities: readonly AmbiguousReservationPosition[]) {
    super(
      `Reservation position is ambiguous for ${ambiguities.length} order line(s): ` +
        ambiguities
          .map(
            (a) =>
              `line ${a.orderLineId} (product ${a.productId}, variant ${
                a.productVariantId ?? 'none'
              }) resolves to positions [${a.candidateInventoryItemIds.join(', ')}]`
          )
          .join('; ') +
        '. Supply an explicit inventoryItemId, or resolve the duplicate positions.'
    );
    this.name = 'AmbiguousReservationPositionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
