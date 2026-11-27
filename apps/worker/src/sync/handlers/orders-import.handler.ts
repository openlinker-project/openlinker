/**
 * Marketplace Orders Import Handler
 *
 * One page of an order import over a date window (#4228): the history of a new
 * connection read newest-first, or a range an operator asked for by hand. The
 * orchestration (lock, adapter probe, children, next page) is core's
 * `OrderIngestionService.importOrderWindow`; this is the thin delegate that maps
 * its outcomes onto job outcomes.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob,
  MarketplaceOrdersImportPayloadV1,
} from '@openlinker/core/sync';
import { ContendedWriteError, SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
  OrderSyncStartUnavailableError,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class OrdersImportHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrdersImportHandler.name);

  constructor(
    @Inject(ORDER_INGESTION_SERVICE_TOKEN)
    private readonly orderIngestion: IOrderIngestionService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    try {
      const result = await this.orderIngestion.importOrderWindow(job.connectionId, payload);
      if (result.skippedDueToLock) {
        // Another page of an import holds the connection's lock for a moment. Ending
        // this job as ok would drop the rest of the chain, and a failure would spend
        // a retry attempt on contention that is not the job's fault, so the runner
        // defers it penalty-free (#2613 / #2617) under its bounded deferral budget.
        throw new ContendedWriteError(
          `Another order import page is running on connection ${job.connectionId}; deferring`,
          `marketplace.orders.import:${job.connectionId}`
        );
      }
      this.logger.log(
        `Order import page ${payload.page} (run ${payload.runId}, connection ${job.connectionId}): fetched=${result.fetched}, enqueued=${result.enqueued}, done=${result.done}`
      );
      return { outcome: 'ok' };
    } catch (error) {
      if (error instanceof SyncJobExecutionError || error instanceof ContendedWriteError) {
        throw error;
      }
      if (error instanceof OrderSyncStartUnavailableError) {
        // The adapter cannot read a window at all; ten retries would only delay the
        // same answer (ADR-007).
        this.logger.error(
          `Order import cannot run for connection ${job.connectionId}: ${error.message}`
        );
        return { outcome: 'business_failure' };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Order import failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOrdersImportPayloadV1 {
    const p = job.payload as unknown as Partial<MarketplaceOrdersImportPayloadV1> | null;
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.runId !== 'string' ||
      (p.direction !== 'oldest-first' && p.direction !== 'newest-first')
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
      runId: p.runId,
      from: typeof p.from === 'string' ? p.from : undefined,
      to: typeof p.to === 'string' ? p.to : undefined,
      direction: p.direction,
      cursor: typeof p.cursor === 'string' ? p.cursor : null,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      page: typeof p.page === 'number' ? p.page : 1,
    };
  }
}
