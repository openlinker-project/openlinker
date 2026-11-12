/**
 * Shopify Not Mapped Exception
 *
 * An OpenLinker internal id has no Shopify id on this connection. A mapping
 * GAP, not a statement about the shop, so it must never become the neutral
 * `MasterProductNotFoundError`: an inferred absence must not stale a catalogue.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyNotMappedException extends Error {
  constructor(
    readonly entityType: string,
    readonly internalId: string,
    readonly connectionId: string,
  ) {
    super(`${entityType} ${internalId} has no Shopify id on connection ${connectionId}`);
    this.name = 'ShopifyNotMappedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
