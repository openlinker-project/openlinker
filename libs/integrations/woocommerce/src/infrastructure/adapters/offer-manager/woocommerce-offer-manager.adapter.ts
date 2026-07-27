/**
 * WooCommerce Offer Manager Adapter
 *
 * Implements `OfferManagerPort` for WooCommerce REST API v3 — quantity
 * write-back only (#1498). The neutral command's `offerId` is the external
 * WooCommerce product id carried by the `ShopProduct` identifier mapping
 * written at publish time; the write is an absolute stock set:
 *   updateOfferQuantity → PUT /products/{id} { manage_stock: true, stock_quantity }
 *
 * Authority model (#1498): master inventory wins, last-write-wins. The write
 * re-asserts `manage_stock: true`, so a product whose managed-stock flag was
 * flipped off shop-side becomes managed again on the next master change.
 *
 * 404 = clean skip: nothing deletes a `ShopProduct` mapping when the product
 * is removed shop-side, so the PUT can 404 forever. Treating it as a skip
 * (warn log, resolve) prevents a retry-to-dead job on every stock change for
 * a stale mapping. All other errors propagate — 401/403 feed the auth-failure
 * classifier, network/5xx feed the runner's transient-retry path.
 *
 * Published WC products are standalone simple products today, so the plain
 * product endpoint suffices — `/variations` handling is a deferred publisher
 * enhancement (see #1498).
 *
 * No `OfferCreator` / `OfferLister` / other sub-capabilities: WooCommerce is
 * a destination shop, not a marketplace — offer creation flows stay gated to
 * `OfferCreator`-declaring adapters.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager
 * @implements {OfferManagerPort}
 */
import type { OfferManagerPort, UpdateOfferQuantityCommand } from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceInvalidArgumentException } from '../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { toPositiveInt } from '../../utils/woocommerce-utils';
import type { WooCommerceStockUpdateBody } from './woocommerce-offer-manager.types';

const PRODUCTS_PATH = '/wp-json/wc/v3/products';

export class WooCommerceOfferManagerAdapter implements OfferManagerPort {
  private readonly logger = new Logger(WooCommerceOfferManagerAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly connection: Connection,
  ) {}

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    // Fail-closed id validation BEFORE any HTTP call: the same job payload is
    // reachable via admin POST /sync/jobs with an arbitrary `offerId` string,
    // so a non-numeric value must never be interpolated into the request path
    // (rules out traversal into other WC REST routes under this connection's
    // credentials). encodeURIComponent is the belt-and-braces backstop.
    const wcProductId = toPositiveInt(cmd.offerId, 'product id');

    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 0) {
      throw new WooCommerceInvalidArgumentException(
        `WooCommerce stock quantity must be a non-negative integer, received: ${JSON.stringify(cmd.quantity)}`,
      );
    }

    const body: WooCommerceStockUpdateBody = {
      manage_stock: true,
      stock_quantity: cmd.quantity,
    };

    try {
      await this.httpClient.put(
        `${PRODUCTS_PATH}/${encodeURIComponent(String(wcProductId))}`,
        body,
      );
    } catch (error) {
      if (error instanceof WooCommerceHttpResponseException && error.statusCode === 404) {
        this.logger.warn(
          `WooCommerce product ${wcProductId} not found on connection ${this.connection.id} — ` +
            `stale ShopProduct mapping (product removed shop-side?). Skipping stock write ` +
            `(quantity=${cmd.quantity} not propagated).`,
        );
        return;
      }
      throw error;
    }

    this.logger.debug(
      `Updated WooCommerce stock: product ${wcProductId} → ${cmd.quantity} (connection: ${this.connection.id})`,
    );
  }
}
