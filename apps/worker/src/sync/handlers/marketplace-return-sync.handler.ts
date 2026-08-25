/**
 * Marketplace Return Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.return.sync' (#2330) — the
 * per-return child the discovery pass fans out. Hydrates one return from its
 * source and persists it idempotently through core.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceReturnSyncPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IReturnIngestionService,
  RETURN_INGESTION_SERVICE_TOKEN,
  ReturnObservationMissingExternalIdError,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceReturnSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceReturnSyncHandler.name);

  constructor(
    @Inject(RETURN_INGESTION_SERVICE_TOKEN)
    private readonly returnIngestion: IReturnIngestionService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.return.sync job ${job.id} for connection ${job.connectionId} (externalReturnId=${payload.externalReturnId})`
    );

    try {
      const result = await this.returnIngestion.syncReturnFromSource(
        job.connectionId,
        payload.externalReturnId
      );

      this.logger.log(
        `Return ${payload.externalReturnId} persisted as ${result.returnId} (attributed=${result.attributed}, connection: ${job.connectionId})`
      );

      return { outcome: 'ok' };
    } catch (error) {
      if (error instanceof ReturnObservationMissingExternalIdError) {
        // TERMINAL, not retryable (ADR-007). The source reported a return with
        // no usable key; no number of retries makes one appear, and core refuses
        // to invent one because a null key has no conflict target and would
        // duplicate the return on every re-sync forever. Burning the retry
        // ladder on it would cost ten attempts and one dead row per occurrence.
        this.logger.warn(
          `Return observation for connection ${job.connectionId} carries no usable external id — terminal, not retried: ${error.message}`
        );
        return { outcome: 'business_failure' };
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace return sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceReturnSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceReturnSyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.externalReturnId || typeof payload.externalReturnId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalReturnId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      externalReturnId: payload.externalReturnId,
      eventKey: payload.eventKey,
      occurredAt: payload.occurredAt,
    };
  }
}
