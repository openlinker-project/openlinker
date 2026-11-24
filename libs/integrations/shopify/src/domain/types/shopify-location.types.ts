/**
 * Shopify Location Types
 *
 * What the connection edit page shows when the operator picks the ONE
 * location OpenLinker reads and writes stock at (#3982).
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyLocationSummary {
  /** Numeric location id, the form `config.locationId` stores. */
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  /** The shop's primary location, used when `config.locationId` is not set. */
  readonly isPrimary: boolean;
}

/** Lists a Shopify connection's locations from the shop itself. */
export interface IShopifyLocationReader {
  listLocations(connectionId: string): Promise<ShopifyLocationSummary[]>;
}

/**
 * Maps an OpenLinker location back to the Shopify location it stands for
 * (provisioned by the multi-location sync, `ownerConnectionId` = the
 * connection, `externalRef` = the Shopify location id). Supplied by the host:
 * the adapter holds no core service.
 */
export interface ShopifyLocationResolverPort {
  /** The numeric Shopify location id, or `null` when this connection does not own that location. */
  resolveShopifyLocationId(connectionId: string, olLocationId: string): Promise<string | null>;
}
