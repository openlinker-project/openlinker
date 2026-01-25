/**
 * Marketplace Orders Poll Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.orders.poll'. Delegates orchestration
 * (cursor safety, locking, dedupe keys, enqueue policy) to core OrderIngestionService.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  MarketplaceOrdersPollPayloadV1,
} from '@openlinker/core/sync';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOrdersPollHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOrdersPollHandler.name);

  constructor(
    @Inject(ORDER_INGESTION_SERVICE_TOKEN)
    private readonly orderIngestion: IOrderIngestionService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.orders.poll job ${job.id} for connection ${job.connectionId} (cursorKey=${payload.cursorKey})`,
    );

    try {
      const result = await this.orderIngestion.syncFromMarketplace(job.connectionId, {
        cursorKey: payload.cursorKey,
        limit: payload.limit,
        eventTypes: payload.eventTypes,
      });

      if (result.skippedDueToLock) {
        this.logger.debug(
          `Skipped ingestion due to lock (connection: ${job.connectionId}). Treating job as succeeded.`,
        );
        return;
      }

      this.logger.log(
        `Ingestion completed (connection: ${job.connectionId}): fetched=${result.fetched}, enqueued=${result.enqueued}, committed=${result.committed}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace orders poll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOrdersPollPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOrdersPollPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (!payload.cursorKey || typeof payload.cursorKey !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid cursorKey in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (payload.limit === undefined || payload.limit === null || typeof payload.limit !== 'number') {
      throw new SyncJobExecutionError(
        `Missing or invalid limit in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return {
      schemaVersion: 1,
      cursorKey: payload.cursorKey,
      limit: payload.limit,
      eventTypes: payload.eventTypes,
    };
  }
}

