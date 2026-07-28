/**
 * Marketplace Offer Pause Stale Sweep Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offer.pauseStaleSweep' (#1689).
 * Scheduled hourly per `OfferManager`-capable connection — the reconcile
 * guarantee that closes the at-most-once gap left by the
 * `events.master.deletion` trigger (a lost/undelivered message would
 * otherwise leave a deleted variant's offer live forever). Delegates to the
 * core `StaleOfferPauseService`, which pages the connection's currently
 * stale-mapped variants straight from the persisted `isStale` flag.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferPauseStaleSweepPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IStaleOfferPauseService,
  STALE_OFFER_PAUSE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

/** Fallback page size when the scheduler descriptor omits `limit` (should not happen in practice). */
const DEFAULT_SWEEP_LIMIT = 200;

@Injectable()
export class MarketplaceOfferPauseStaleSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferPauseStaleSweepHandler.name);

  constructor(
    @Inject(STALE_OFFER_PAUSE_SERVICE_TOKEN)
    private readonly staleOfferPause: IStaleOfferPauseService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.debug(
      `Executing marketplace.offer.pauseStaleSweep job ${job.id} for connection ${job.connectionId} (limit=${payload.limit})`
    );

    try {
      const result = await this.staleOfferPause.sweepConnection(job.connectionId, {
        limit: payload.limit,
      });
      if (result.offersPaused > 0) {
        this.logger.log(
          `Stale-offer pause sweep re-asserted ${result.offersPaused} offer(s) for connection ${job.connectionId}`
        );
      }
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer pause-stale sweep failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferPauseStaleSweepPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferPauseStaleSweepPayloadV1>;
    const limit =
      payload && typeof payload.limit === 'number' && payload.limit > 0
        ? payload.limit
        : DEFAULT_SWEEP_LIMIT;
    return { schemaVersion: 1, limit };
  }
}
