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
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferQuantityUpdatePayloadV1,
} from '@openlinker/core/sync';
import { ContendedWriteError, SyncJobExecutionError } from '@openlinker/core/sync';
import { IInventorySyncService, INVENTORY_SYNC_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferQuantityUpdateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferQuantityUpdateHandler.name);

  constructor(
    @Inject(INVENTORY_SYNC_SERVICE_TOKEN)
    private readonly inventorySync: IInventorySyncService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offerQuantity.update job ${job.id} for connection ${job.connectionId} (offerId=${payload.offerId}, quantity=${payload.quantity})`
    );

    try {
      const result = await this.inventorySync.updateOfferQuantity(job.connectionId, {
        offerId: payload.offerId,
        quantity: payload.quantity,
        idempotencyKey: payload.idempotencyKey,
        observedAt: payload.observedAt,
      });

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const message = `Offer quantity update failed for offer ${failure.offerId}: ${failure.errorCode}${failure.message ? ` (${failure.message})` : ''}`;
        // Contention is the write-order guard doing its job, not this job
        // failing: a peer holds the lock, so nothing was written and nothing
        // was rejected. Reported as a ContendedWriteError so the runner defers
        // it penalty-free instead of spending an attempt, which under raised
        // propagation concurrency could otherwise dead-letter the very stock
        // write the guard protects (#2617 review). Only when EVERY failure is
        // contention - a real rejection alongside it is a real failure and
        // must walk the ordinary ladder.
        const allContended = result.failed.every((f) => f.errorCode === 'write_contended');
        throw new SyncJobExecutionError(
          message,
          job.id,
          job.jobType,
          job.connectionId,
          allContended ? new ContendedWriteError(message, failure.offerId) : undefined
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
        error instanceof Error ? error : undefined
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
        job.connectionId
      );
    }
    if (!payload.offerId || typeof payload.offerId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid offerId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (
      payload.quantity === undefined ||
      payload.quantity === null ||
      typeof payload.quantity !== 'number'
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid quantity in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    // #2285 — `observedAt` is an optional versioning hint, not a requirement: a
    // payload enqueued before it existed carries none, so ANY non-string value
    // (including null) coerces to absent with one warn. Never fail the job on it.
    let observedAt: string | undefined;
    if (typeof payload.observedAt === 'string') {
      observedAt = payload.observedAt;
    } else if (payload.observedAt !== undefined) {
      this.logger.warn(
        `Ignoring non-string observedAt in payload for job ${job.id} (offerId=${payload.offerId}); the derived idempotency key will be unversioned`
      );
    }

    return {
      schemaVersion: 1,
      offerId: payload.offerId,
      quantity: payload.quantity,
      idempotencyKey: payload.idempotencyKey,
      // Also the ordering token for the write-order guard (#2617). A legacy job
      // queued across the deploy carries none and writes unguarded, as before.
      observedAt,
    };
  }
}
