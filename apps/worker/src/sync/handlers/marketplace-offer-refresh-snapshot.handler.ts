/**
 * Marketplace Offer Refresh Snapshot Handler (#1760)
 *
 * Post-terminal reconcile for a single offer: re-reads the live marketplace
 * publication status via core `OfferStatusSyncService.refreshOne` and upserts
 * `offer_status_snapshots`, so an offer Allegro activates after the creation
 * poll budget lapsed (#447) surfaces `active` on the operator read (#816) well
 * before the hourly steady-state sync. Bounded, self-rescheduling: while the
 * offer is not yet terminally published and attempts remain, it enqueues the
 * next attempt with the next delay from the shared schedule.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferRefreshSnapshotPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  ISyncJobsService,
  SYNC_JOBS_SERVICE_TOKEN,
  OFFER_REFRESH_SNAPSHOT_DELAYS_SECONDS,
  OFFER_REFRESH_SNAPSHOT_MAX_ATTEMPTS,
} from '@openlinker/core/sync';
import {
  IOfferStatusSyncService,
  OFFER_STATUS_SYNC_SERVICE_TOKEN,
  type OfferPublicationStatus,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const REFRESH_SNAPSHOT_JOB_TYPE = 'marketplace.offer.refreshSnapshot';
const RUNNER_RETRY_BUDGET = 3;

/**
 * Publication statuses that end the reconcile: `active`/`ended` are terminal
 * publications, so there's nothing more to catch. `activating`/`inactivating`/
 * `inactive` are still-in-flight and warrant another attempt.
 */
const TERMINAL_PUBLICATION_STATUSES: ReadonlySet<OfferPublicationStatus> = new Set([
  'active',
  'ended',
]);

@Injectable()
export class MarketplaceOfferRefreshSnapshotHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferRefreshSnapshotHandler.name);

  constructor(
    @Inject(OFFER_STATUS_SYNC_SERVICE_TOKEN)
    private readonly offerStatusSync: IOfferStatusSyncService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    let status: OfferPublicationStatus | null;
    try {
      status = await this.offerStatusSync.refreshOne(job.connectionId, {
        externalOfferId: payload.externalOfferId,
        internalVariantId: payload.internalVariantId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer refresh-snapshot failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }

    this.logger.log(
      `marketplace.offer.refreshSnapshot (connection=${job.connectionId}, offerId=${payload.externalOfferId}, attempt=${payload.attempt}): status=${status ?? 'unknown'}`
    );

    // Stop when there's nothing to catch: adapter unsupported / offer not found
    // (null), or the offer reached a terminal publication state.
    if (status === null || TERMINAL_PUBLICATION_STATUSES.has(status)) {
      return { outcome: 'ok' };
    }

    // Still in flight — schedule the next bounded attempt if any remain.
    const nextAttempt = payload.attempt + 1;
    if (nextAttempt > OFFER_REFRESH_SNAPSHOT_MAX_ATTEMPTS) {
      this.logger.log(
        `marketplace.offer.refreshSnapshot exhausted ${OFFER_REFRESH_SNAPSHOT_MAX_ATTEMPTS} attempts for offer ${payload.externalOfferId}; the hourly status sync remains the backstop.`
      );
      return { outcome: 'ok' };
    }

    await this.scheduleNextAttempt(job.connectionId, payload, nextAttempt);
    return { outcome: 'ok' };
  }

  private async scheduleNextAttempt(
    connectionId: string,
    payload: MarketplaceOfferRefreshSnapshotPayloadV1,
    nextAttempt: number
  ): Promise<void> {
    const delaySeconds = OFFER_REFRESH_SNAPSHOT_DELAYS_SECONDS[nextAttempt - 1];
    const nextPayload: MarketplaceOfferRefreshSnapshotPayloadV1 = {
      schemaVersion: 1,
      externalOfferId: payload.externalOfferId,
      internalVariantId: payload.internalVariantId,
      attempt: nextAttempt,
    };
    await this.syncJobs.schedule({
      jobType: REFRESH_SNAPSHOT_JOB_TYPE,
      connectionId,
      payload: nextPayload as unknown as Record<string, unknown>,
      idempotencyKey: `refreshSnapshot:${payload.externalOfferId}:${nextAttempt}`,
      maxAttempts: RUNNER_RETRY_BUDGET,
      runAfter: new Date(Date.now() + delaySeconds * 1000),
    });
    this.logger.debug(
      `Scheduled snapshot reconcile attempt ${nextAttempt} for offer ${payload.externalOfferId} at +${delaySeconds}s.`
    );
  }

  private getPayload(job: SyncJob): MarketplaceOfferRefreshSnapshotPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferRefreshSnapshotPayloadV1>;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.externalOfferId !== 'string' ||
      typeof payload.internalVariantId !== 'string' ||
      typeof payload.attempt !== 'number'
    ) {
      throw new SyncJobExecutionError(
        `Invalid payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      externalOfferId: payload.externalOfferId,
      internalVariantId: payload.internalVariantId,
      attempt: payload.attempt,
    };
  }
}
