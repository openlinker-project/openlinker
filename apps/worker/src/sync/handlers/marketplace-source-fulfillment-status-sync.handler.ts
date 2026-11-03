/**
 * Marketplace Source Fulfillment Status Sync Handler (ADR-012 amendment)
 *
 * Thin delegate for jobs of type `marketplace.sourceFulfillment.statusSync`.
 * Drives one page of the source-side fulfilment read-back via the core
 * `SourceFulfillmentStatusSyncService` - records a waybill the order's SOURCE
 * reports when somebody other than OpenLinker shipped it there - and persists
 * the rolling scan offset on the connection cursor so the next run continues
 * where this one stopped.
 *
 * Mirrors `MarketplaceFulfillmentStatusSyncHandler` line for line, because both
 * wrap a core service that returns the `nextOffset` the caller should persist.
 * Disjoint by direction: that handler reads an order's DESTINATION, this one
 * its SOURCE, so the two run under different cursor keys and different sweep
 * locks - a connection that is both a source and a destination must not have
 * one scan advance the other's offset.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MarketplaceSourceFulfillmentStatusSyncPayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import {
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type ISyncCursorsService,
  type SyncLockPort,
} from '@openlinker/core/sync';
import {
  ISourceFulfillmentStatusSyncService,
  SOURCE_FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';
import { resolveScanSweepLockTtlMs, runExclusiveScanSweep } from '../scan-sweep-lock';

const JOB_TYPE = 'marketplace.sourceFulfillment.statusSync';
const DEFAULT_LIMIT = 100;
/**
 * Fallback for a hand-enqueued job with no `cursorKey`. Platform-neutral on
 * purpose: unlike the destination read-back, more than one platform implements
 * this from the start (Shoper and Allegro), and every scheduler task supplies
 * its own key. Cursors are per connection, so a neutral key cannot collide.
 */
const DEFAULT_CURSOR_KEY = 'sourceFulfillmentStatus.scanOffset';

@Injectable()
export class MarketplaceSourceFulfillmentStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceSourceFulfillmentStatusSyncHandler.name);

  constructor(
    @Inject(SOURCE_FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN)
    private readonly sourceFulfillmentStatusSync: ISourceFulfillmentStatusSyncService,
    // The cursor through the published `I*Service`, never the repository port:
    // the worker sits outside the sync context (architecture-overview.md
    // § Cross-context dependencies in core).
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  /**
   * One page per run, and at most one run per connection: the page reads the
   * scan cursor and writes it back, so two overlapping runs would race it and
   * skip a cycle of orders (#2594 review).
   */
  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    return runExclusiveScanSweep({
      syncLock: this.syncLock,
      kind: 'source-fulfillment-status',
      connectionId: job.connectionId,
      lockTtlMs: resolveScanSweepLockTtlMs(
        this.configService.get<string>('OL_SCAN_SWEEP_LOCK_TTL_MS')
      ),
      jobType: JOB_TYPE,
      logger: this.logger,
      run: () => this.syncPage(job),
    });
  }

  private async syncPage(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const offset = this.parseOffset(await this.cursors.getCursor(job.connectionId, cursorKey));

    this.logger.log(
      `Executing ${JOB_TYPE} job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, offset=${offset})`
    );

    try {
      const result = await this.sourceFulfillmentStatusSync.sync(job.connectionId, {
        limit: payload.limit,
        offset,
        updatedSinceDays: payload.updatedSinceDays,
      });

      this.logger.log(
        `${JOB_TYPE} completed (connection=${job.connectionId}): scanned=${result.scanned}, created=${result.created}, updated=${result.updated}, relayed=${result.relayed}, skipped=${result.skipped}, failed=${result.failed}, nextOffset=${result.nextOffset}/${result.total}`
      );

      // A scan offset wraps back to 0 by design, so it is advanced
      // unconditionally - never through the monotonic variant.
      await this.cursors.advanceCursor(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace source fulfillment status sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceSourceFulfillmentStatusSyncPayloadV1 {
    const payload =
      job.payload as unknown as Partial<MarketplaceSourceFulfillmentStatusSyncPayloadV1> | null;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    const limit =
      typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
        ? payload.limit
        : DEFAULT_LIMIT;
    return {
      schemaVersion: 1,
      limit,
      cursorKey: typeof payload.cursorKey === 'string' ? payload.cursorKey : undefined,
      updatedSinceDays:
        typeof payload.updatedSinceDays === 'number' &&
        Number.isFinite(payload.updatedSinceDays) &&
        payload.updatedSinceDays > 0
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
