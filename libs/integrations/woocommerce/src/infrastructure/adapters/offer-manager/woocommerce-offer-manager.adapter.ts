/**
 * WooCommerce Offer Manager Adapter
 *
 * Implements `OfferManagerPort` for WooCommerce REST API v3 — quantity
 * write-back only (#1498). The neutral command's `offerId` is the external
 * WooCommerce product id carried by the `ShopProduct` identifier mapping
 * written at publish time; the write is an absolute stock set:
 *   updateOfferQuantity → PUT /products/{id} { manage_stock: true, stock_quantity }
 *   (or PUT /products/{parentId}/variations/{id} for a variation, see below)
 *
 * Authority model (#1498): master inventory wins, last-write-wins. The write
 * re-asserts `manage_stock: true`, so a product whose managed-stock flag was
 * flipped off shop-side becomes managed again on the next master change.
 *
 * 404 = stale mapping cleanup: the mapped WC product was removed shop-side, so
 * the PUT 404s. Rather than silently skipping forever (a dead mapping that
 * 404s on every future stock change), delete the `ShopProduct` identifier
 * mapping for this (external product id, connection) and resolve — the next
 * publish then re-creates the product and writes a fresh mapping (#1846 fix 5).
 * All other errors propagate — 401/403 feed the auth-failure classifier,
 * network/5xx feed the runner's transient-retry path.
 *
 * Variations (#3962): a multi-variant publish (#1836) creates one variable
 * parent plus one variation per sibling, and a variation only exists under its
 * parent - `products/{variationId}` 404s. The caller therefore passes
 * `externalParentId` for a variation and the write goes to
 * `products/{parentId}/variations/{id}`. Without it the plain product address
 * was hit, 404'd, and the cleanup below deleted a perfectly live variation's
 * mapping. A command without a parent keeps the simple-product address and the
 * same 404 cleanup: this adapter cannot tell a variation id from a product id,
 * so naming the parent is the caller's job. A 404 UNDER a parent never deletes
 * the mapping - the stored parent can be the wrong one - it fails the write.
 *
 * No `OfferCreator` / `OfferLister` / other sub-capabilities: WooCommerce is
 * a destination shop, not a marketplace — offer creation flows stay gated to
 * `OfferCreator`-declaring adapters.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager
 * @implements {OfferManagerPort}
 */
import type { OfferManagerPort, UpdateOfferQuantityCommand } from '@openlinker/core/listings';
import {
  CORE_ENTITY_TYPE,
  type Connection,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
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
    private readonly identifierMapping: IdentifierMappingPort,
  ) {}

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    // Fail-closed id validation BEFORE any HTTP call: the same job payload is
    // reachable via admin POST /sync/jobs with an arbitrary `offerId` string,
    // so a non-numeric value must never be interpolated into the request path
    // (rules out traversal into other WC REST routes under this connection's
    // credentials). encodeURIComponent is the belt-and-braces backstop.
    const wcProductId = toPositiveInt(cmd.offerId, 'product id');
    const wcParentId =
      cmd.externalParentId !== undefined
        ? toPositiveInt(cmd.externalParentId, 'parent product id')
        : undefined;

    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 0) {
      throw new WooCommerceInvalidArgumentException(
        `WooCommerce stock quantity must be a non-negative integer, received: ${JSON.stringify(cmd.quantity)}`,
      );
    }

    const body: WooCommerceStockUpdateBody = {
      manage_stock: true,
      stock_quantity: cmd.quantity,
    };

    const productPath = `${PRODUCTS_PATH}/${encodeURIComponent(String(wcProductId))}`;
    const path =
      wcParentId !== undefined
        ? `${PRODUCTS_PATH}/${encodeURIComponent(String(wcParentId))}/variations/` +
          encodeURIComponent(String(wcProductId))
        : productPath;

    try {
      await this.httpClient.put(path, body);
    } catch (error) {
      // Under a parent a 404 does not prove the variation is gone: the parent
      // OpenLinker holds can be the wrong one (two siblings published at once
      // used to create two parents, #3962), and deleting the mapping then
      // unlinks a live variation for good. Keep the mapping and fail loudly.
      if (
        error instanceof WooCommerceHttpResponseException &&
        error.statusCode === 404 &&
        wcParentId !== undefined
      ) {
        this.logger.warn(
          `WooCommerce variation ${wcProductId} not found under parent ${wcParentId} on connection ` +
            `${this.connection.id}; keeping the ShopProduct mapping (the stored parent may be wrong). ` +
            `quantity=${cmd.quantity} not propagated.`,
        );
        throw error;
      }
      // A simple product's own address 404ing means it really is gone shop-side.
      if (error instanceof WooCommerceHttpResponseException && error.statusCode === 404) {
        this.logger.warn(
          `WooCommerce product ${wcProductId} not found on connection ${this.connection.id} - ` +
            `stale ShopProduct mapping (product removed shop-side?). Deleting the mapping so a ` +
            `future publish re-creates it (quantity=${cmd.quantity} not propagated this run).`,
        );
        // Clean the dead mapping (idempotent) so it stops 404'ing on every stock
        // change; the next publish re-creates the product and writes a fresh one.
        await this.identifierMapping.deleteMapping(
          CORE_ENTITY_TYPE.ShopProduct,
          String(wcProductId),
          this.connection.id,
        );
        return;
      }
      throw error;
    }

    this.logger.debug(
      `Updated WooCommerce stock: product ${wcProductId}` +
        `${wcParentId !== undefined ? ` (variation of ${wcParentId})` : ''} → ${cmd.quantity} ` +
        `(connection: ${this.connection.id})`,
    );
  }
}
