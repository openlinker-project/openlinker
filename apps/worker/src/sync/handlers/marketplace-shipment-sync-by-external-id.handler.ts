/**
 * Marketplace Shipment Sync-By-External-Id Handler (#768, ADR-021)
 *
 * Thin delegate for jobs of type `marketplace.shipment.syncByExternalId` — the
 * trigger half of the InPost webhook flow. An inbound `Shipment.Tracking`
 * webhook routes here carrying the carrier's own parcel id; the handler asks
 * the core `ShipmentStatusSyncService` to refresh that one shipment
 * (connection-scoped, authoritative re-read via `getTracking`). The webhook
 * payload's own status is never trusted — the re-read is the source of truth.
 *
 * Mirrors the per-shipment primitive the paged `marketplace.shipment.statusSync`
 * poll (#838) drives; this is the single-parcel, no-cursor sibling.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  MarketplaceShipmentSyncByExternalIdPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IShipmentStatusSyncService,
  SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceShipmentSyncByExternalIdHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceShipmentSyncByExternalIdHandler.name);

  constructor(
    @Inject(SHIPMENT_STATUS_SYNC_SERVICE_TOKEN)
    private readonly shipmentStatusSync: IShipmentStatusSyncService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const { externalId } = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.shipment.syncByExternalId job ${job.id} for connection ${job.connectionId} (providerShipmentId=${externalId})`,
    );

    try {
      await this.shipmentStatusSync.syncOneByProviderShipmentId(job.connectionId, externalId);
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace shipment sync-by-external-id failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceShipmentSyncByExternalIdPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceShipmentSyncByExternalIdPayloadV1>;
    if (!payload || typeof payload !== 'object' || typeof payload.externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid payload (externalId) for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return { schemaVersion: 1, externalId: payload.externalId };
  }
}
