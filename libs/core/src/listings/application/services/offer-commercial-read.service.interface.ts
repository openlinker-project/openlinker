/**
 * Offer Commercial Read Service Interface (#3621)
 *
 * The operator-facing read of what a marketplace REPORTS it is showing for a
 * variant - the "Channel shows" figure of the stock view (decision G-3).
 *
 * @module libs/core/src/listings/application/services
 * @see {@link OfferCommercialReadService} for the implementation
 */

/**
 * One variant's last-observed quantity on one connection.
 *
 * `availableQuantity` is what the marketplace reported at `observedAt` - already
 * net of the connection's `stockSafetyBuffer` and zero threshold - and is
 * `null` when the marketplace reported none. `null` is NEVER zero: it renders
 * as "Not seen yet", not as a sell-out.
 */
export interface ChannelObservedQuantity {
  readonly connectionId: string;
  readonly internalVariantId: string;
  readonly externalOfferId: string;
  readonly availableQuantity: number | null;
  readonly observedAt: Date;
}

export interface IOfferCommercialReadService {
  /**
   * The newest observation per `(variant, connection)`, from the persisted
   * `offer_commercial_snapshots` - no marketplace call. A variant with several
   * offers on one connection reports the most recently synced one. A variant
   * or connection with no snapshot is simply absent from the result.
   */
  getObservedQuantities(
    variantIds: readonly string[]
  ): Promise<readonly ChannelObservedQuantity[]>;
}
