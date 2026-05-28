/**
 * Marketplace Shipment Status Sync Handler (#838)
 *
 * Thin delegate for jobs of type `marketplace.shipment.statusSync`. Refreshes
 * one page of a carrier connection's non-terminal `Shipment`s via the core
 * `ShipmentStatusSyncService` and persists the rolling scan offset on the
 * connection cursor so the next run continues where this one stopped.
 *
 * Mirrors `MarketplaceOfferStatusSyncHandler` (#816) — the cursor-advance
 * pattern is identical because both wrap a core service that returns the
 * `nextOffset` the caller should persist.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  MarketplaceShipmentStatusSyncPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  ConnectionCursorRepositoryPort,
  SyncJobExecutionError,
} from '@openlinker/core/sync';
import {
  IShipmentStatusSyncService,
  SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 50;
const DEFAULT_CURSOR_KEY = 'allegro.shipmentStatus.scanOffset';

@Injectable()
export class MarketplaceShipmentStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceShipmentStatusSyncHandler.name);

  constructor(
    @Inject(SHIPMENT_STATUS_SYNC_SERVICE_TOKEN)
    private readonly shipmentStatusSync: IShipmentStatusSyncService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const storedOffset = await this.cursorRepository.get(job.connectionId, cursorKey);
    const offset = this.parseOffset(storedOffset);

    this.logger.log(
      `Executing marketplace.shipment.statusSync job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, offset=${offset})`,
    );

    try {
      const result = await this.shipmentStatusSync.sync(job.connectionId, {
        limit: payload.limit,
        offset,
      });

      this.logger.log(
        `marketplace.shipment.statusSync completed (connection=${job.connectionId}): scanned=${result.scanned}, updated=${result.updated}, propagated=${result.propagated}, failed=${result.failed}, nextOffset=${result.nextOffset}/${result.total}`,
      );

      await this.cursorRepository.set(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace shipment status sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceShipmentStatusSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceShipmentStatusSyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    const limit =
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT;
    return {
      schemaVersion: 1,
      limit,
      cursorKey: typeof payload.cursorKey === 'string' ? payload.cursorKey : undefined,
    };
  }

  private parseOffset(stored: string | null): number {
    if (stored === null) {
      return 0;
    }
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}
