/**
 * Marketplace Fulfillment Status Sync Handler (#834)
 *
 * Thin delegate for jobs of type `marketplace.fulfillment.statusSync`.
 * Drives one page of branch-1 (OMP-fulfilled) shipment status read-back
 * via the core `FulfillmentStatusSyncService` and persists the rolling
 * scan offset on the connection cursor so the next run continues where
 * this one stopped.
 *
 * Mirrors `MarketplaceShipmentStatusSyncHandler` (#871) — the
 * cursor-advance pattern is identical because both wrap a core service
 * that returns the `nextOffset` the caller should persist. Disjoint by
 * branch: this handler projects branch-1 rows; the sibling handler
 * refreshes branch-2/3 rows. The two never write the same Shipment.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  MarketplaceFulfillmentStatusSyncPayloadV1,
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
  IFulfillmentStatusSyncService,
  FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
/**
 * Default for the unlikely case a job lands without an explicit
 * `cursorKey` in its payload (the PrestaShop scheduler task always
 * supplies one; this default fires only for hand-enqueued jobs). Mirrors
 * `MarketplaceShipmentStatusSyncHandler`'s default — the handler is
 * OMP-generic, but the only OMP supporting branch-1 today is PrestaShop.
 * When a second OMP adopts `FulfillmentStatusReader`, parameterize the
 * default by reading `connection.platformType` rather than hard-coding here.
 */
const DEFAULT_CURSOR_KEY = 'prestashop.fulfillmentStatus.scanOffset';

@Injectable()
export class MarketplaceFulfillmentStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceFulfillmentStatusSyncHandler.name);

  constructor(
    @Inject(FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN)
    private readonly fulfillmentStatusSync: IFulfillmentStatusSyncService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const storedOffset = await this.cursorRepository.get(job.connectionId, cursorKey);
    const offset = this.parseOffset(storedOffset);

    this.logger.log(
      `Executing marketplace.fulfillment.statusSync job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, offset=${offset})`,
    );

    try {
      const result = await this.fulfillmentStatusSync.sync(job.connectionId, {
        limit: payload.limit,
        offset,
        updatedSinceDays: payload.updatedSinceDays,
      });

      this.logger.log(
        `marketplace.fulfillment.statusSync completed (connection=${job.connectionId}): scanned=${result.scanned}, created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}, nextOffset=${result.nextOffset}/${result.total}`,
      );

      await this.cursorRepository.set(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace fulfillment status sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceFulfillmentStatusSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceFulfillmentStatusSyncPayloadV1>;
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
      updatedSinceDays:
        typeof payload.updatedSinceDays === 'number' && payload.updatedSinceDays > 0
          ? payload.updatedSinceDays
          : undefined,
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
