/**
 * Published-Scoped Reserved Sum (#2628 review, ADR-061 decision 1)
 *
 * The one SQL definition of *"how many units of this position are claimed by
 * holds that actually reduce what OpenLinker publishes"* — i.e.
 * `Σ quantity WHERE status = 'held' AND atpEffect = 'published'`, per position.
 *
 * **Why this exists at all.** `inventory_items.olReservedQuantity` is a single
 * denormalised counter that legitimately sums holds of BOTH stamps, so every
 * consumer of it must scope by `atpEffect` for itself or it silently attributes
 * operator-visible consequences to `diagnostic` holds — which is a
 * contradiction in terms: the stamp exists precisely to say "record this, do
 * not let it restrict anything" (`ReservationLedgerReader` docblock). On the
 * DEFAULT `omp_fulfilled` topology every hold is `diagnostic` and no shipped
 * closer runs, so the counter grows without bound; an `atpEffect`-blind reader
 * of it therefore degrades on a perfectly healthy install — a false shortfall
 * episode naming a real order, or a refused reservation on stock that is there.
 *
 * Two shipped readers need it, which is why it is a shared definition rather
 * than two copies that must be kept agreeing by hand:
 *
 * - `ReservationRepository.applyGuardedAdd` — the admission guard's subtrahend.
 * - `ReservationShortfallRepository` — the two shortfall-position predicates.
 *
 * The third reader, `ReservationLedgerReader.sumReservedByVariantIds`, does NOT
 * use this fragment: it scopes by a bound `atpEffect` parameter through the
 * query builder, is grouped by variant rather than by position, and was already
 * correct. Both express the same rule; only this one has to be raw, because its
 * callers are raw guarded statements.
 *
 * `IDX_reservations_atp_sum` on `(status, atpEffect, inventoryItemId)` serves
 * the subquery exactly — all three predicate columns, in order.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/sql
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */

/** A bare SQL identifier — a table alias. */
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A positional bind placeholder, `$1` .. `$n`. */
const PLACEHOLDER = /^\$[1-9][0-9]*$/;

export interface PublishedReservedSumOptions {
  /**
   * Alias of the `inventory_items` row the sum is correlated to. A compile-time
   * literal chosen by the calling statement — never a value, and asserted to be
   * a bare identifier so this can never become an interpolation seam.
   */
  readonly positionAlias: string;
  /**
   * Optional `$n` placeholder holding a `reservations.id` to EXCLUDE.
   *
   * Load-bearing for the admission guard and for nothing else. `claimOne`
   * inserts (or locks) the ledger row BEFORE it moves the counter, so by the
   * time the guard runs, this claim's own units are already inside the sum. A
   * guard that did not exclude them would test the claim against itself and
   * refuse every reservation larger than half the free stock.
   */
  readonly excludeReservationIdParam?: string;
}

/**
 * The scalar sub-select, `COALESCE`d to `0` so a position with no published
 * hold contributes a number rather than `NULL` to the surrounding arithmetic.
 */
export function publishedReservedSum(options: PublishedReservedSumOptions): string {
  const { positionAlias, excludeReservationIdParam } = options;

  if (!ALIAS.test(positionAlias)) {
    throw new Error(
      `publishedReservedSum: positionAlias must be a bare SQL identifier, received "${positionAlias}"`,
    );
  }
  if (excludeReservationIdParam !== undefined && !PLACEHOLDER.test(excludeReservationIdParam)) {
    throw new Error(
      `publishedReservedSum: excludeReservationIdParam must be a positional placeholder ` +
        `like "$2", received "${excludeReservationIdParam}"`,
    );
  }

  const exclusion =
    excludeReservationIdParam === undefined
      ? ''
      : `\n              AND "r_pub"."id" <> ${excludeReservationIdParam}`;

  return (
    `COALESCE((SELECT SUM("r_pub"."quantity")\n` +
    `            FROM "reservations" "r_pub"\n` +
    `           WHERE "r_pub"."inventoryItemId" = "${positionAlias}"."id"\n` +
    `             AND "r_pub"."status" = 'held'\n` +
    `             AND "r_pub"."atpEffect" = 'published'${exclusion}), 0)`
  );
}
