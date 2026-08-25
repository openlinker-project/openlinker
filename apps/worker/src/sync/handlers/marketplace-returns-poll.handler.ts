/**
 * Marketplace Returns Poll Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.returns.poll' (#2330). Every
 * decision that matters — the per-connection lock, the capability narrowing, the
 * dedupe keys, and above all the rule that the cursor advances only after every
 * child enqueue succeeded — lives in core `ReturnIngestionService`. This file
 * moves a payload and reports an outcome.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceReturnsPollPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IReturnIngestionService,
  RETURN_INGESTION_SERVICE_TOKEN,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_CURSOR_KEY = 'allegro.customerReturns.lastReturnId';
const DEFAULT_LIMIT = 100;

@Injectable()
export class MarketplaceReturnsPollHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceReturnsPollHandler.name);

  constructor(
    @Inject(RETURN_INGESTION_SERVICE_TOKEN)
    private readonly returnIngestion: IReturnIngestionService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.returns.poll job ${job.id} for connection ${job.connectionId} (cursorKey=${payload.cursorKey})`
    );

    try {
      const result = await this.returnIngestion.ingestReturns(job.connectionId, {
        cursorKey: payload.cursorKey,
        limit: payload.limit,
      });

      if (result.skippedDueToLock) {
        this.logger.debug(
          `Skipped returns ingestion due to lock (connection: ${job.connectionId}). Treating job as succeeded.`
        );
        return { outcome: 'ok' };
      }

      this.logger.log(
        `Returns ingestion completed (connection: ${job.connectionId}): fetched=${result.fetched}, enqueued=${result.enqueued}, committed=${result.committed}, droppedWithoutId=${result.droppedWithoutId}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace returns poll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceReturnsPollPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceReturnsPollPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const cursorKey =
      typeof payload.cursorKey === 'string' && payload.cursorKey
        ? payload.cursorKey
        : DEFAULT_CURSOR_KEY;
    const limit =
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT;
    return { schemaVersion: 1, cursorKey, limit };
  }
}
