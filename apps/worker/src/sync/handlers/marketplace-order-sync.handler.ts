/**
 * Marketplace Order Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.order.sync'. Delegates hydration + routing
 * to core OrderIngestionService.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOrderSyncPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IOrderIngestionService,
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_REFUND_OBSERVATION_SERVICE_TOKEN,
  type IOrderRefundObservationService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOrderSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOrderSyncHandler.name);

  constructor(
    @Inject(ORDER_INGESTION_SERVICE_TOKEN)
    private readonly orderIngestion: IOrderIngestionService,
    @Inject(ORDER_REFUND_OBSERVATION_SERVICE_TOKEN)
    private readonly refundObservation: IOrderRefundObservationService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.order.sync job ${job.id} for connection ${job.connectionId} (externalOrderId=${payload.externalOrderId})`
    );

    try {
      await this.orderIngestion.syncOrderFromSource(
        job.connectionId,
        payload.externalOrderId,
        payload.sourceEventId,
        payload.eventType
      );

      await this.observeSourceRefunds(job.connectionId, payload.externalOrderId);

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace order sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * A refund made on the channel never reaches the order read, so it is observed
   * here, right after the order was ingested: the order sync job already runs
   * once per changed order, which bounds the extra channel call to orders that
   * moved. Best-effort - the order is already synced, and a failure here must
   * not retry the whole ingestion; the next event for the order observes again.
   */
  private async observeSourceRefunds(connectionId: string, externalOrderId: string): Promise<void> {
    try {
      await this.refundObservation.observeSourceRefunds(connectionId, externalOrderId);
    } catch (error) {
      this.logger.warn(
        `Source refund observation failed for order ${externalOrderId} on connection ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOrderSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOrderSyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.externalOrderId || typeof payload.externalOrderId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalOrderId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      externalOrderId: payload.externalOrderId,
      sourceEventId: payload.sourceEventId ?? payload.eventKey,
      eventKey: payload.eventKey,
      occurredAt: payload.occurredAt,
      eventType: payload.eventType,
    };
  }
}
