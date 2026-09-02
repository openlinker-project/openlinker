/**
 * Offer Stock Restore Types (#2348)
 *
 * The reported outcome of one cancellation sequence. It exists because the
 * issue requires every NON-restoring exit to be observable: a `Promise<void>`
 * lets a handler log "executed" and nothing else, so an offer that was never
 * republished looks exactly like one that was. Mirrors the shape
 * `ConsumeShipmentReservationsResult` establishes in `shipping`.
 *
 * @module libs/core/src/listings/application/types
 */

export const OfferStockRestoreOutcomeValues = [
  /** ATP was published to the marketplace. */
  'restored',
  /**
   * The order's goods already shipped (`Shipment.reservationConsumedAt`), so
   * there is nothing to give back. Per #2348's stated assumption, the
   * cancelled-after-dispatch contradiction is DISPLAYED (story L6), not
   * reconciled by republishing a quantity here.
   */
  'skipped-consumed',
  /**
   * The connection's adapter exposes no `OfferStockRestorer` — the routine case
   * (Allegro restores its own stock on cancellation). The RELEASE still ran.
   */
  'skipped-no-restorer',
  /**
   * Nothing publishable resolved: no order record, no resolved variants, no
   * offer mapping, or availability unknown for every mapped variant. The last
   * of those is deliberate — an unknown quantity is OMITTED, never written as
   * `0`, because `0` is the primitive #1689 uses to PAUSE an offer.
   *
   * FOUR causes collapse into this one value, each still logged distinctly at
   * `debug`. That is fine while nothing counts them; if a metric or an operator
   * fact ever hangs off this field, **split the availability-unknown arm
   * first** — the other three are ordinary "this order has nothing on this
   * marketplace" states, whereas availability-unknown means a read FAILED and a
   * live offer was deliberately left un-republished.
   */
  'skipped-no-targets',
] as const;

export type OfferStockRestoreOutcome = (typeof OfferStockRestoreOutcomeValues)[number];

export interface OfferStockRestoreResult {
  /** Reservations moved `held → released` by this call. */
  readonly released: number;
  /** Reservations that had already left `held` — expected, benign. */
  readonly alreadyTerminal: number;
  /** Offers whose quantity was published. `0` on every skipped outcome. */
  readonly offersRestored: number;
  readonly outcome: OfferStockRestoreOutcome;
}
