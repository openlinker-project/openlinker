/**
 * Stock At Risk Read Service
 *
 * Computes the stock-at-risk "needs attention" aggregate (#1983): variants
 * listed on a connection that the connection cannot currently sell.
 *
 * The predicate is `availableToPromise <= 0` in the destination's `channel`
 * scope (#2323), asked of `IAvailabilityService` rather than recomputed from
 * master stock and a locally-read buffer. On a Wave-1b install the two agree
 * exactly (`max(0, totalAvailable − buffer)` with an empty ledger), so no row
 * moves; the predicate widens as intended once `published` holds exist.
 *
 * Lives in the `listings` context (not `inventory`) so it can inject the two
 * listing-mapping repository ports intra-context while reaching `inventory`
 * for the master-stock read via the already-established one-directional
 * `listings → inventory` module edge (`ListingsModule` already imports
 * `InventoryModule` for #824; the reverse import does not exist, so an
 * inventory-context service cannot call back into `listings` without
 * introducing a NestJS module cycle).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IStockAtRiskReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import {
  AVAILABILITY_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IAvailabilityService,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import { ShopProductMappingRepositoryPort } from '../../domain/ports/shop-product-mapping-repository.port';
import type { StockAtRiskItem, StockAtRiskResult } from '../../domain/types/stock-at-risk.types';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IStockAtRiskReadService } from './stock-at-risk-read.service.interface';

// Per-connection candidate cap — bounds the availability read so a connection
// with a very large catalogue can't produce an unbounded fan-in (#1983 AC).
const MAX_STOCK_AT_RISK_CANDIDATES = 500;

@Injectable()
export class StockAtRiskReadService implements IStockAtRiskReadService {
  private readonly logger = new Logger(StockAtRiskReadService.name);

  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly shopProductMappingRepository: ShopProductMappingRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQueryService: IInventoryQueryService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService
  ) {}

  async findStockAtRisk(limit: number): Promise<StockAtRiskResult> {
    const capableConnections = await this.resolveBufferedConnections();

    const perConnectionItems = await Promise.all(
      capableConnections.map((connection) => this.findAtRiskForConnection(connection))
    );
    const items = perConnectionItems.flat();

    return { items: items.slice(0, limit), totalCount: items.length };
  }

  private async findAtRiskForConnection(connection: {
    connectionId: string;
  }): Promise<StockAtRiskItem[]> {
    const [offerRows, shopRows] = await Promise.all([
      this.offerMappingRepository.findRecentlyListedVariantIds({
        connectionId: connection.connectionId,
        limit: MAX_STOCK_AT_RISK_CANDIDATES,
      }),
      this.shopProductMappingRepository.findRecentlyListedVariantIds({
        connectionId: connection.connectionId,
        limit: MAX_STOCK_AT_RISK_CANDIDATES,
      }),
    ]);

    const productIdByVariantId = new Map<string, string>();
    for (const row of [...offerRows, ...shopRows]) {
      productIdByVariantId.set(row.variantId, row.productId);
    }
    if (productIdByVariantId.size === 0) return [];

    const variantIds = [...productIdByVariantId.keys()];
    const scope = { kind: 'channel' as const, connectionId: connection.connectionId };

    const [availabilities, promisable, buffer] = await Promise.all([
      // Still the master-stock read: `masterStock` is a display field, and it is
      // what the shortfall is measured against.
      this.inventoryQueryService.getAvailabilityByVariantIds(variantIds),
      // The predicate. Channel-scoped, so the destination's own Controls are
      // already inside the number — nothing is subtracted again below.
      this.availabilityService.getPromisableQuantities({ variantIds, scope }),
      // Display only (#2323): `getAppliedReserve` exists so this surface can
      // show the cushion without reading the buffer helpers directly.
      this.availabilityService.getAppliedReserve(scope),
    ]);

    const masterStockByVariant = new Map(
      availabilities.map((a) => [a.productVariantId, a.totalAvailable])
    );

    const items: StockAtRiskItem[] = [];
    let warnedUnknown = false;
    for (const entry of promisable) {
      if (entry.quantity === null) {
        // Never emit a row asserting a number OL does not have. One line per
        // connection, not per variant: an unknown is batch-wide by contract.
        if (!warnedUnknown) {
          warnedUnknown = true;
          this.logger.warn(
            `stock_at_risk_skipped_availability_unknown connection=${connection.connectionId} ` +
              `variants=${promisable.length} — availability could not be resolved, so these ` +
              `variants are omitted from the at-risk aggregate rather than reported as at risk`
          );
        }
        continue;
      }
      if (entry.quantity > 0) continue;

      const masterStock = masterStockByVariant.get(entry.productVariantId) ?? 0;
      items.push({
        variantId: entry.productVariantId,
        productId:
          productIdByVariantId.get(entry.productVariantId) ?? entry.productVariantId,
        connectionId: connection.connectionId,
        masterStock,
        stockSafetyBuffer: buffer,
        availableToPromise: entry.quantity,
        shortfall: Math.max(0, masterStock - buffer - entry.quantity),
      });
    }
    return items;
  }

  /**
   * Every active connection with `OfferManager` or `ProductPublisher` enabled.
   *
   * Carries no buffer of its own since #2323 — the cushion is a Control the
   * availability seam owns, resolved per connection in
   * `findAtRiskForConnection`. A connection with no configured buffer is still
   * included: per `checkRequiredToSell`'s `OUT_OF_STOCK` rule (#1842), zero
   * available-to-promise is unsellable regardless of the cushion.
   */
  private async resolveBufferedConnections(): Promise<Array<{ connectionId: string }>> {
    const [offerManagerAdapters, productPublisherAdapters] = await Promise.all([
      this.integrationsService.listCapabilityAdapters({ capability: 'OfferManager', lazy: true }),
      this.integrationsService.listCapabilityAdapters({
        capability: 'ProductPublisher',
        lazy: true,
      }),
    ]);

    const byConnectionId = new Map<string, { connectionId: string }>();
    for (const entry of [...offerManagerAdapters, ...productPublisherAdapters]) {
      byConnectionId.set(entry.connectionId, { connectionId: entry.connectionId });
    }
    return [...byConnectionId.values()];
  }
}
