/**
 * Marketplace Offer Stock Restore Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offer.stockRestore' (#1146).
 * Enqueued by the OrderIngestionService cancellation-observe hook; resolves the
 * cancelled order's offers and issues the destination marketplace's
 * stock-restore via the core OfferStockRestoreService (which narrows the
 * connection's adapter to the OfferStockRestorer capability and no-ops when it
 * is absent). The restore is an absolute set from master inventory — re-runnable
 * by construction, so a retry never double-counts.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferStockRestorePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IOfferStockRestoreService,
  OFFER_STOCK_RESTORE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferStockRestoreHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferStockRestoreHandler.name);

  constructor(
    @Inject(OFFER_STOCK_RESTORE_SERVICE_TOKEN)
    private readonly offerStockRestore: IOfferStockRestoreService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.stockRestore job ${job.id} for connection ${job.connectionId}`
    );

    try {
      await this.offerStockRestore.restoreStockForCancelledOrder(
        job.connectionId,
        payload.internalOrderId
      );
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer stock restore failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferStockRestorePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferStockRestorePayloadV1>;
    if (!payload || typeof payload !== 'object' || typeof payload.internalOrderId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return { schemaVersion: 1, internalOrderId: payload.internalOrderId };
  }
}
