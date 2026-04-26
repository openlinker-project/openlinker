/**
 * Marketplace Offer Quantity Update Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offerQuantity.update'. Delegates
 * update logic (batch vs single, idempotency key generation, partial failure handling)
 * to core InventorySyncService.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  MarketplaceOfferQuantityUpdatePayloadV1,
} from '@openlinker/core/sync';
import {
  IInventorySyncService,
  INVENTORY_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferQuantityUpdateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferQuantityUpdateHandler.name);

  constructor(
    @Inject(INVENTORY_SYNC_SERVICE_TOKEN)
    private readonly inventorySync: IInventorySyncService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offerQuantity.update job ${job.id} for connection ${job.connectionId} (offerId=${payload.offerId}, quantity=${payload.quantity})`,
    );

    try {
      const result = await this.inventorySync.updateOfferQuantity(job.connectionId, {
        offerId: payload.offerId,
        quantity: payload.quantity,
        idempotencyKey: payload.idempotencyKey,
      });

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        throw new SyncJobExecutionError(
          `Offer quantity update failed for offer ${failure.offerId}: ${failure.errorCode}${failure.message ? ` (${failure.message})` : ''}`,
          job.id,
          job.jobType,
          job.connectionId,
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      if (error instanceof SyncJobExecutionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer quantity update failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferQuantityUpdatePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferQuantityUpdatePayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (!payload.offerId || typeof payload.offerId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid offerId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (payload.quantity === undefined || payload.quantity === null || typeof payload.quantity !== 'number') {
      throw new SyncJobExecutionError(
        `Missing or invalid quantity in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return {
      schemaVersion: 1,
      offerId: payload.offerId,
      quantity: payload.quantity,
      idempotencyKey: payload.idempotencyKey,
    };
  }
}

