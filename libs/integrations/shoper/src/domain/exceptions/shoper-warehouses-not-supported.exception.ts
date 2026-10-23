/**
 * ShoperWarehousesNotSupportedException
 *
 * Thrown by the stock adapter on a shop that runs Shoper's multi-warehouse
 * module (`application-config.warehouses_enabled`, a Premium plan feature,
 * SPIKE-3638 M10). With the module on, `product-stocks.stock` is not known to be
 * the shop's whole pool, so any total reported from it could be silently wrong -
 * and a wrong stock level is published to marketplaces. v1 stock is pooled and
 * location-less (ADR-058 decision 2); located stock is a separate piece of work.
 *
 * Deterministic for the connection (only an operator turning the module off, or
 * a future release, changes it), so the retry classifier treats it as terminal.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperWarehousesNotSupportedException extends Error {
  constructor(readonly connectionId: string) {
    super(
      `Shoper connection ${connectionId} uses the multi-warehouse module, which this ` +
        'integration does not support yet: product-stocks.stock may not be the whole stock, ' +
        'so no stock level is reported. Turn the module off in the shop, or keep this ' +
        'connection to ProductMaster only.',
    );
    this.name = 'ShoperWarehousesNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
