/**
 * Stock At Risk Read Service
 *
 * Computes the stock-at-risk "needs attention" aggregate (#1983): variants
 * listed on a connection that publish nothing there.
 *
 * The predicate is the connection's own publish policy, applied by the same
 * pure helper the write paths use. The zero threshold (#2610) is a second way
 * to publish nothing, so leaving it out made this count under-report exactly
 * the lines the threshold had silenced - which is the one place an operator
 * would look for them.
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
import {
  applyStockSafetyBuffer,
  readStockSafetyBuffer,
  readStockZeroThreshold,
} from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
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
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly shopProductMappingRepository: ShopProductMappingRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQueryService: IInventoryQueryService
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
    buffer: number;
    zeroThreshold: number;
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

    const availabilities = await this.inventoryQueryService.getAvailabilityByVariantIds([
      ...productIdByVariantId.keys(),
    ]);

    const items: StockAtRiskItem[] = [];
    for (const availability of availabilities) {
      const published = applyStockSafetyBuffer(
        availability.totalAvailable,
        connection.buffer,
        connection.zeroThreshold
      );
      if (published === 0) {
        items.push({
          variantId: availability.productVariantId,
          productId:
            productIdByVariantId.get(availability.productVariantId) ??
            availability.productVariantId,
          connectionId: connection.connectionId,
          masterStock: availability.totalAvailable,
          stockSafetyBuffer: connection.buffer,
          stockZeroThreshold: connection.zeroThreshold,
        });
      }
    }
    return items;
  }

  /**
   * Every active connection with `OfferManager` or `ProductPublisher`
   * enabled, carrying its configured stock publish policy (both knobs `0`
   * when unset - per `checkRequiredToSell`'s `OUT_OF_STOCK` rule (#1842),
   * zero master stock is unsellable whatever the policy says, so a
   * policy-less connection is still included and still reported at risk).
   */
  private async resolveBufferedConnections(): Promise<
    Array<{ connectionId: string; buffer: number; zeroThreshold: number }>
  > {
    const [offerManagerAdapters, productPublisherAdapters] = await Promise.all([
      this.integrationsService.listCapabilityAdapters({ capability: 'OfferManager', lazy: true }),
      this.integrationsService.listCapabilityAdapters({
        capability: 'ProductPublisher',
        lazy: true,
      }),
    ]);

    const byConnectionId = new Map<
      string,
      { connectionId: string; buffer: number; zeroThreshold: number }
    >();
    for (const entry of [...offerManagerAdapters, ...productPublisherAdapters]) {
      byConnectionId.set(entry.connectionId, {
        connectionId: entry.connectionId,
        buffer: readStockSafetyBuffer(entry.connection.config),
        zeroThreshold: readStockZeroThreshold(entry.connection.config),
      });
    }
    return [...byConnectionId.values()];
  }
}
