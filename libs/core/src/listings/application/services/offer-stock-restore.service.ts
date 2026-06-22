/**
 * Offer Stock Restore Service
 *
 * Orchestrates the order-cancellation stock-restore (#1146 / ADR-025 §4a). When
 * an order transitions to `cancelled`, the `OrderIngestionService` observe hook
 * enqueues a `marketplace.offer.stockRestore` job; the worker handler delegates
 * here. This service:
 *   1. loads the order record (`IOrderRecordService`) → resolved variant ids;
 *   2. resolves the distinct external offer ids for those variants on the source
 *      connection (`OfferMappingRepositoryPort.findMany`);
 *   3. reads the absolute master-inventory target per variant
 *      (`IInventoryQueryService.getAvailabilityByVariantIds`, #823) — master is
 *      authoritative, including 0;
 *   4. builds `OfferStockRestoreTarget[]` and dispatches the destination
 *      `OfferStockRestorer` capability (no-op when honestly absent).
 *
 * The restore is an ABSOLUTE set from master inventory — re-runnable by
 * construction, so a job retry never double-counts. The adapter never reads
 * master inventory; core resolves it here and passes plain targets, keeping the
 * plugin contract free of any core inventory service.
 *
 * Log hygiene (no PII): never logs an order id at info, never logs buyer data.
 * The internal `ol_order_*` id appears only at debug.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStockRestoreService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IInventoryQueryService, INVENTORY_QUERY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import type {
  OfferManagerPort,
  OfferStockRestoreTarget
} from '@openlinker/core/listings';
import { isOfferStockRestorer ,
  OfferMappingRepositoryPort} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IOfferStockRestoreService } from '../interfaces/offer-stock-restore.service.interface';

/**
 * Offer-mapping lookups are scoped per-variant (`internalId` filter), so a
 * variant maps to at most a handful of offer rows; a small page suffices.
 */
const OFFER_MAPPING_PAGE_LIMIT = 10;

@Injectable()
export class OfferStockRestoreService implements IOfferStockRestoreService {
  private readonly logger = new Logger(OfferStockRestoreService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
  ) {}

  async restoreStockForCancelledOrder(
    connectionId: string,
    internalOrderId: string,
  ): Promise<void> {
    const record = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (!record) {
      this.logger.debug(
        `Stock-restore skipped: no order record found [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return;
    }

    const variantIds = this.collectVariantIds(record.orderSnapshot);
    if (variantIds.length === 0) {
      this.logger.debug(
        `Stock-restore skipped: order has no resolved variants [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return;
    }

    // Resolve distinct external offer ids for these variants on the source
    // connection. One variant maps to at most one offer per connection here;
    // dedupe defensively so a variant with multiple mappings restores once.
    const externalOfferIdByVariant = await this.resolveExternalOfferIds(connectionId, variantIds);
    if (externalOfferIdByVariant.size === 0) {
      this.logger.debug(
        `Stock-restore skipped: no offer mapping for the order's variants [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return;
    }

    const mappedVariantIds = [...externalOfferIdByVariant.keys()];
    const availability = await this.inventoryQuery.getAvailabilityByVariantIds(mappedVariantIds);
    const targetByVariant = new Map(
      availability.map((row) => [row.productVariantId, row.totalAvailable]),
    );

    const targets: OfferStockRestoreTarget[] = [];
    for (const [variantId, externalOfferId] of externalOfferIdByVariant) {
      // Master is authoritative including 0; a variant absent from the read
      // zero-fills via getAvailabilityByVariantIds, so default to 0 defensively.
      const quantity = targetByVariant.get(variantId) ?? 0;
      targets.push({ externalOfferId, quantity });
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );
    if (!isOfferStockRestorer(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} adapter does not support OfferStockRestorer; skipping stock restore`,
      );
      return;
    }

    this.logger.debug(
      `Restoring marketplace stock for ${targets.length} offer(s) [connectionId=${connectionId}, orderId=${internalOrderId}]`,
    );
    await adapter.restoreStockOnCancellation(targets);
  }

  /**
   * Pull the resolved internal variant ids from the persisted order snapshot.
   * `recordStatus='ready'` snapshots store the unified `Order` whose items carry
   * `variantId`; an `awaiting_mapping` snapshot (raw IncomingOrder) carries no
   * variant ids and yields an empty list (no-op). Reads defensively without
   * binding to the snapshot's full JSON layout. Deduped, order-preserving.
   */
  private collectVariantIds(snapshot: Record<string, unknown>): string[] {
    const items = snapshot.items;
    if (!Array.isArray(items)) {
      return [];
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (item && typeof item === 'object') {
        const variantId = (item as { variantId?: unknown }).variantId;
        if (typeof variantId === 'string' && variantId.length > 0) {
          seen.add(variantId);
        }
      }
    }
    return [...seen];
  }

  /**
   * Map each variant id to its distinct external offer id on the connection.
   * Queries the `Offer` mappings per variant (`internalId` filter;
   * `externalId`=offer id, `internalId`=variant id). Variants with no offer
   * mapping are omitted; the first mapping wins when a variant has several.
   */
  private async resolveExternalOfferIds(
    connectionId: string,
    variantIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const variantId of variantIds) {
      const page = await this.offerMappings.findMany(
        { connectionId, internalId: variantId },
        { limit: OFFER_MAPPING_PAGE_LIMIT, offset: 0 },
      );
      const mapping = page.items[0];
      if (mapping) {
        result.set(variantId, mapping.externalId);
      }
    }
    return result;
  }
}
