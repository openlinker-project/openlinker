/**
 * Marketplace Offer Quantity Reconcile Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offerQuantity.reconcile'
 * (#2621). The "confirm later" half of a non-blocking quantity write:
 * resolves the connection's `OfferManager` adapter via core
 * `OfferQuantityAckReconcileService`, which no-ops for a connection whose
 * adapter doesn't declare `PendingQuantityAckReconciler`.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferQuantityReconcilePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IOfferQuantityAckReconcileService,
  OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;

@Injectable()
export class MarketplaceOfferQuantityReconcileHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferQuantityReconcileHandler.name);

  constructor(
    @Inject(OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN)
    private readonly reconcileService: IOfferQuantityAckReconcileService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offerQuantity.reconcile job ${job.id} for connection ${job.connectionId} (limit=${payload.limit})`
    );

    try {
      const result = await this.reconcileService.reconcile(job.connectionId, payload.limit);

      this.logger.log(
        `marketplace.offerQuantity.reconcile completed (connection=${job.connectionId}): reconciled=${result.reconciled}, stillPending=${result.stillPending}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer quantity reconcile failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferQuantityReconcilePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferQuantityReconcilePayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const limit =
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT;
    return { schemaVersion: 1, limit };
  }
}
