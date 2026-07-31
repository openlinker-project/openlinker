/**
 * Marketplace Offer Pause Stale Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offer.pauseStale' (#1689).
 * Enqueued by the `events.master.deletion` stream consumer whenever a
 * `master.variant.stale` / `master.product.stale` event lands. Delegates to
 * the core `StaleOfferPauseService`, which re-verifies each variant's
 * `isStale` flag before zeroing its mapped offers' quantity.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferPauseStalePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IStaleOfferPauseService,
  STALE_OFFER_PAUSE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferPauseStaleHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferPauseStaleHandler.name);

  constructor(
    @Inject(STALE_OFFER_PAUSE_SERVICE_TOKEN)
    private readonly staleOfferPause: IStaleOfferPauseService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.pauseStale job ${job.id} (variants=${payload.variantIds.length}, correlationId=${payload.correlationId})`
    );

    try {
      const result = await this.staleOfferPause.pauseOffersForVariants({
        variantIds: payload.variantIds,
        correlationId: payload.correlationId,
      });
      this.logger.log(
        `Stale-offer pause complete: considered=${result.variantsConsidered}, stillStale=${result.variantsStillStale}, paused=${result.offersPaused}, skipped=${result.offersSkipped} (correlationId=${payload.correlationId})`
      );
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer pause-stale failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferPauseStalePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferPauseStalePayloadV1>;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.internalProductId !== 'string' ||
      !Array.isArray(payload.variantIds) ||
      payload.variantIds.length === 0 ||
      !payload.variantIds.every((id) => typeof id === 'string') ||
      typeof payload.correlationId !== 'string'
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      internalProductId: payload.internalProductId,
      variantIds: payload.variantIds,
      correlationId: payload.correlationId,
    };
  }
}
