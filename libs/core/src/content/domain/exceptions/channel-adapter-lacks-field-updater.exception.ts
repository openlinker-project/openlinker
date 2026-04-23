/**
 * Channel Adapter Lacks Field Updater Exception
 *
 * Thrown when a channel content publish is requested for a connection whose
 * `OfferManagerPort` adapter does not implement the optional
 * `OfferFieldUpdater` capability. Surfaced as HTTP 422 — the adapter is valid
 * and healthy, it simply cannot receive offer-field updates.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class ChannelAdapterLacksFieldUpdaterException extends Error {
  public readonly productId: string;
  public readonly connectionId: string;
  public readonly fieldKey: string;

  constructor(productId: string, connectionId: string, fieldKey: string) {
    super(
      `Channel adapter for connection ${connectionId} does not implement OfferFieldUpdater; cannot publish content for product ${productId}, field "${fieldKey}".`,
    );
    this.name = 'ChannelAdapterLacksFieldUpdaterException';
    this.productId = productId;
    this.connectionId = connectionId;
    this.fieldKey = fieldKey;
    Error.captureStackTrace(this, this.constructor);
  }
}
