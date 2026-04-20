/**
 * Master Catalog Connection Not Configured Exception
 *
 * Raised when building a marketplace offer requires resolving master-catalog
 * product data (name, description, images, price) but the marketplace
 * connection has no `masterCatalogConnectionId` set in its config.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class MasterCatalogConnectionNotConfiguredException extends Error {
  constructor(public readonly marketplaceConnectionId: string) {
    super(
      `Marketplace connection ${marketplaceConnectionId} has no masterCatalogConnectionId configured; cannot resolve master product data for offer creation`,
    );
    this.name = 'MasterCatalogConnectionNotConfiguredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
