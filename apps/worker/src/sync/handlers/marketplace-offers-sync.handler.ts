/**
 * Marketplace Offers Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.offers.sync'. Delegates
 * offer mapping population to core OfferMappingSyncService.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOffersSyncPayloadV1,
  SyncJobRequest,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import {
  IOfferMappingSyncService,
  OFFER_MAPPING_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOffersSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOffersSyncHandler.name);

  constructor(
    @Inject(OFFER_MAPPING_SYNC_SERVICE_TOKEN)
    private readonly offerMappingSync: IOfferMappingSyncService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    const feedType = payload.feedType ?? (payload.cursorKey ? 'events' : 'offers');
    if (feedType === 'events' && (!payload.cursorKey || typeof payload.cursorKey !== 'string')) {
      throw new SyncJobExecutionError(
        `Missing or invalid cursorKey for events feed: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const storedCursor = payload.cursorKey
      ? await this.cursorRepository.get(job.connectionId, payload.cursorKey)
      : null;
    const effectiveCursor = payload.cursor ?? storedCursor ?? null;

    this.logger.log(
      `Executing marketplace.offers.sync job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, feedType=${feedType}, cursor=${effectiveCursor ?? 'none'})`
    );

    try {
      const result = await this.offerMappingSync.sync(job.connectionId, {
        limit: payload.limit,
        cursor: effectiveCursor,
        feedType,
        masterConnectionId: payload.masterConnectionId ?? null,
      });

      this.logger.log(
        `marketplace.offers.sync completed (connection=${job.connectionId}): scanned=${result.scanned}, linked=${result.linked}, skipped=${result.skipped}`
      );

      const nextCursor = result.nextCursor;
      const cursorAdvanced = typeof nextCursor === 'string' && nextCursor !== effectiveCursor;

      if (payload.cursorKey && cursorAdvanced) {
        await this.cursorRepository.set(job.connectionId, payload.cursorKey, nextCursor);
      }

      if (cursorAdvanced) {
        const followUpPayload: MarketplaceOffersSyncPayloadV1 = {
          schemaVersion: 1,
          limit: payload.limit,
          cursor: nextCursor,
          cursorKey: payload.cursorKey,
          feedType,
          masterConnectionId: payload.masterConnectionId ?? null,
        };

        const idempotencyKey = `marketplace.offers.sync:${feedType}:${job.connectionId}:${nextCursor}`;

        const followUpRequest: SyncJobRequest = {
          jobType: 'marketplace.offers.sync',
          connectionId: job.connectionId,
          payload: followUpPayload as unknown as Record<string, unknown>,
          idempotencyKey,
        };

        await this.jobEnqueue.enqueueJob(followUpRequest);

        this.logger.debug(
          `Enqueued follow-up marketplace.offers.sync job (connection=${job.connectionId}, cursor=${nextCursor})`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offers sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOffersSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOffersSyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const limit = typeof payload.limit === 'number' ? payload.limit : 100;
    return {
      schemaVersion: 1,
      limit,
      cursor: payload.cursor ?? null,
      cursorKey: payload.cursorKey,
      feedType: payload.feedType,
      masterConnectionId: payload.masterConnectionId ?? null,
    };
  }
}
