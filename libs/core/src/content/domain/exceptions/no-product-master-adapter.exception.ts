/**
 * No Product Master Adapter Exception
 *
 * Thrown by `IntegrationsContentPublisher` when a master-path publish is
 * requested but the integrations registry has no active `ProductMaster`
 * capability adapter to route through. Indicates a configuration gap
 * (no PrestaShop / OpenLinker / Shopify connection registered as the
 * master) rather than a runtime failure of the underlying adapter.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class NoProductMasterAdapterException extends Error {
  constructor(
    public readonly productId: string,
    public readonly fieldKey: string,
  ) {
    super(
      `No active ProductMaster adapter is registered; cannot publish content (productId=${productId} fieldKey=${fieldKey}). Configure a connection that supports the ProductMaster capability.`,
    );
    this.name = 'NoProductMasterAdapterException';
    Error.captureStackTrace(this, this.constructor);
  }
}
