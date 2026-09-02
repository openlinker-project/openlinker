/**
 * Marketplace Offer Stock Restore Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offer.stockRestore' (#1146).
 * Enqueued by the OrderIngestionService cancellation-observe hook; the core
 * OfferStockRestoreService runs the whole ordered cancellation sequence —
 * release the order's reservation holds, then publish the recomputed
 * available-to-promise (#2348). The restore is an absolute set, re-runnable by
 * construction, so a retry never double-counts.
 *
 * The service's reported outcome is logged with job context, because most runs
 * legitimately do NOT restore (the connection has no OfferStockRestorer, the
 * order already shipped, nothing mapped) and "executed" alone cannot tell those
 * apart from a real republish. A release that could not close every hold throws
 * — deliberately a job failure, since returning `ok` would retire the work with
 * live holds standing and no reconcile sweep to heal it.
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
      const result = await this.offerStockRestore.restoreStockForCancelledOrder(
        job.connectionId,
        payload.internalOrderId
      );
      this.logger.log(
        `marketplace.offer.stockRestore job ${job.id} finished: outcome=${result.outcome} ` +
          `released=${String(result.released)} alreadyTerminal=${String(result.alreadyTerminal)} ` +
          `offersRestored=${String(result.offersRestored)}`
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
