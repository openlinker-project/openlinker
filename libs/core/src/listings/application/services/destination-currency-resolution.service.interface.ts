/**
 * Destination Currency Resolution Service Interface (#3203)
 *
 * Resolves a destination connection's real, adapter-declared currency, so
 * `price-change-block.types.ts`'s `readConnectionCurrency` callers get a
 * verified answer instead of the `Connection.config.currency` key that (on
 * the repo's default topology) no destination form ever writes.
 * Destination-kind-agnostic: the caller supplies a connection id and the
 * service probes which capability declares the currency — mirroring
 * `IDescriptionFormatReadService`.
 *
 * @module libs/core/src/listings/application/services
 */
export interface IDestinationCurrencyResolutionService {
  /**
   * The connection's declared currency, or `null` when neither
   * `OfferManager` nor `ProductPublisher` resolves, or the resolved adapter
   * declares nothing. `null` is never a match/mismatch signal by itself —
   * see `resolvePriceChangeBlockReason`'s `'destination-currency-unknown'`
   * handling of an unresolvable currency.
   */
  resolveForConnection(connectionId: string): Promise<string | null>;
}
