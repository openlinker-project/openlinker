/**
 * Marketplace Orders Poll Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.orders.poll'. Delegates orchestration
 * (cursor safety, locking, dedupe keys, enqueue policy) to core OrderIngestionService.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOrdersPollPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  SchedulerTaskRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
  OrderSyncStartUnavailableError,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class OrdersPollHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrdersPollHandler.name);

  constructor(
    @Inject(ORDER_INGESTION_SERVICE_TOKEN)
    private readonly orderIngestion: IOrderIngestionService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
    private readonly schedulerTaskRegistry: SchedulerTaskRegistryService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? (await this.resolveDefaultCursorKey(job));
    if (!cursorKey) {
      // Writing under another platform's key would corrupt that feed's bookmark (#3991),
      // and retrying cannot change the answer.
      this.logger.error(
        `Job ${job.id} has no cursorKey and the plugin of connection ${job.connectionId} declares none; refusing to poll`
      );
      return { outcome: 'business_failure' };
    }

    this.logger.log(
      `Executing marketplace.orders.poll job ${job.id} for connection ${job.connectionId} (cursorKey=${cursorKey})`
    );

    try {
      const result = await this.orderIngestion.ingestOrders(job.connectionId, {
        cursorKey,
        limit: payload.limit,
        eventTypes: payload.eventTypes,
      });

      if (result.skippedDueToLock) {
        this.logger.debug(
          `Skipped ingestion due to lock (connection: ${job.connectionId}). Treating job as succeeded.`
        );
        return { outcome: 'ok' };
      }

      this.logger.log(
        `Ingestion completed (connection: ${job.connectionId}): fetched=${result.fetched}, enqueued=${result.enqueued}, committed=${result.committed}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      if (error instanceof OrderSyncStartUnavailableError) {
        // The chosen start can never be applied to this connection as it stands, so
        // retrying ten times only delays the same answer (ADR-007): end the job as a
        // business failure. The message is operator-readable and names the remedy.
        this.logger.error(
          `Order sync cannot start for connection ${job.connectionId}: ${error.message}`
        );
        return { outcome: 'business_failure' };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace orders poll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * The plugin's own scheduled poll task is the one declaration of its feed cursor, so a manual
   * poll with no cursorKey reads it from there instead of core naming any platform's key.
   */
  private async resolveDefaultCursorKey(job: SyncJob): Promise<string | null> {
    const connection = await this.connectionPort.get(job.connectionId);
    const task = this.schedulerTaskRegistry
      .getAll()
      .find((t) => t.jobType === job.jobType && t.platformType === connection.platformType);
    if (!task) {
      return null;
    }
    const declared = task.generatePayload(connection).cursorKey;
    return typeof declared === 'string' && declared ? declared : null;
  }

  private getPayload(
    job: SyncJob
  ): Omit<MarketplaceOrdersPollPayloadV1, 'cursorKey'> & { cursorKey?: string } {
    const payload = job.payload as unknown as Partial<MarketplaceOrdersPollPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const cursorKey =
      typeof payload.cursorKey === 'string' && payload.cursorKey ? payload.cursorKey : undefined;
    const limit = typeof payload.limit === 'number' ? payload.limit : 100;
    return {
      schemaVersion: 1,
      cursorKey,
      limit,
      eventTypes: payload.eventTypes,
    };
  }
}
