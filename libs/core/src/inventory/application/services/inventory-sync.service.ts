/**
 * Inventory Sync Service
 *
 * Core-owned orchestration for propagating inventory-derived quantities to marketplaces.
 *
 * @module libs/core/src/inventory/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { OfferManagerPort, isOfferQuantityBatchUpdater } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { UpdateOfferQuantityCommand, UpdateOfferQuantitiesBatchCommand, UpdateOfferQuantitiesBatchResult } from '@openlinker/core/listings';
import { IInventorySyncService } from './inventory-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class InventorySyncService implements IInventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async updateOfferQuantity(
    connectionId: string,
    cmd: UpdateOfferQuantityCommand,
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    return this.updateOfferQuantities(connectionId, { items: [cmd] });
  }

  async updateOfferQuantities(
    connectionId: string,
    cmd: UpdateOfferQuantitiesBatchCommand,
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    if (!cmd.items || cmd.items.length === 0) {
      return { succeeded: [], failed: [] };
    }

    const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );

    const normalized: UpdateOfferQuantitiesBatchCommand = {
      idempotencyKey: cmd.idempotencyKey,
      items: cmd.items.map((i) => ({
        ...i,
        idempotencyKey: i.idempotencyKey ?? this.buildIdempotencyKey(connectionId, i.offerId, i.quantity),
      })),
    };

    // Prefer adapter batch API when available and we have more than one item.
    if (isOfferQuantityBatchUpdater(marketplace) && normalized.items.length > 1) {
      try {
        return await marketplace.updateOfferQuantitiesBatch(normalized);
      } catch (error) {
        // Fall back to per-item to allow partial progress if batch fails.
        this.logger.warn(
          `Batch offer quantity update failed, falling back to per-item updates: ${(error as Error).message}`,
        );
      }
    }

    const result: UpdateOfferQuantitiesBatchResult = { succeeded: [], failed: [] };

    for (const item of normalized.items) {
      try {
        await marketplace.updateOfferQuantity(item);
        result.succeeded.push(item.offerId);
      } catch (error) {
        result.failed.push({
          offerId: item.offerId,
          errorCode: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private buildIdempotencyKey(connectionId: string, offerId: string, quantity: number): string {
    // Deterministic, compact idempotency key (avoid long hashes).
    const raw = `inventory:${connectionId}:${offerId}:${quantity}`;
    const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `inv:${digest}`;
  }
}

