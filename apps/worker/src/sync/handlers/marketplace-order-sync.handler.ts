/**
 * Marketplace Order Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.order.sync'. Delegates hydration + routing
 * to core OrderIngestionService.
 *
 * A `source_deleted` item-resolution failure (#2928) is reported as a
 * terminal `business_failure` rather than retried — see the catch block.
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
  MissingOrderItemMappingError,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOrderSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOrderSyncHandler.name);

  constructor(
    @Inject(ORDER_INGESTION_SERVICE_TOKEN)
    private readonly orderIngestion: IOrderIngestionService
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

      return { outcome: 'ok' };
    } catch (error) {
      // #2928 — a `source_deleted` item resolution failure never self-heals
      // (the master deleted the product a mapped variant pointed at, and a
      // recreate there usually mints a new external id, so the old mapping
      // stays stale forever). Retrying it re-pays the full marketplace
      // hydration (`OrderSourcePort.getOrder`) on every attempt to
      // re-discover a fact already persisted on `order_records` — measured
      // at ~5 attempts/order against a stale sandbox catalogue, ~1.1 s each.
      // Report it as a terminal `business_failure` (ADR-007) instead of
      // throwing, so the runner does not retry a permanent condition — the
      // `master_deleted` precedent on `master.product.syncByExternalId`.
      // An ordinary `awaiting_mapping` gap (`recordStatus` undefined here)
      // is unaffected and still retries with backoff.
      if (
        error instanceof MissingOrderItemMappingError &&
        error.recordStatus === 'source_deleted'
      ) {
        this.logger.warn(
          `Marketplace order sync: order item deleted at source, will not retry (job ${job.id}, connection: ${job.connectionId}, externalOrderId=${payload.externalOrderId}): ${error.message}`
        );
        return { outcome: 'business_failure', outcomeReason: 'source_deleted' };
      }

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
