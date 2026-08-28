/**
 * Orders Tax Rate Backfill Handler (#2440)
 *
 * Thin delegate for jobs of type `orders.taxRate.backfill`. Refreshes one
 * page of one connection's rate-less `order_line_items` rows via core
 * `ITaxRateBackfillService` and persists the resumable id cursor on the
 * connection cursor — the same scan-offset shape
 * `MarketplaceOfferStatusSyncHandler` follows, except the cursor here is the
 * last scanned row's id rather than a numeric offset (`findPageWithNoTaxRate`
 * orders by id, so an id cursor is what stays stable across a concurrent
 * write, the same reasoning `AllegroOrderSourceAdapter`'s event-id cursor
 * already uses elsewhere).
 *
 * Always `outcome: 'ok'` on a completed tick, mirroring every other sweep —
 * a tick that resolved nothing (catalogue not synced yet) is not a business
 * failure of the sweep itself. Only a failure of the page read/write escapes
 * as a retryable throw.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  OrdersTaxRateBackfillPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import { ITaxRateBackfillService, TAX_RATE_BACKFILL_SERVICE_TOKEN } from '@openlinker/core/orders';
import { ConfigService } from '@nestjs/config';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { resolveScanSweepLockTtlMs, runExclusiveScanSweep } from '../scan-sweep-lock';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
const DEFAULT_CURSOR_KEY = 'orders.taxRate.backfill.afterId';

@Injectable()
export class OrdersTaxRateBackfillHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrdersTaxRateBackfillHandler.name);

  constructor(
    @Inject(TAX_RATE_BACKFILL_SERVICE_TOKEN)
    private readonly taxRateBackfill: ITaxRateBackfillService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  /**
   * One page per run, and at most one run per connection (#2594 review).
   *
   * The page below reads the scan cursor and writes it back, so two runs for
   * one connection would race it and skip a whole cycle of rows. The `bulk`
   * lane used to serialise them at `perScope: 1`; it no longer does.
   */
  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    return runExclusiveScanSweep({
      syncLock: this.syncLock,
      kind: 'orders-tax-rate',
      connectionId: job.connectionId,
      lockTtlMs: resolveScanSweepLockTtlMs(
        this.configService.get<string>('OL_SCAN_SWEEP_LOCK_TTL_MS')
      ),
      jobType: 'orders.taxRate.backfill',
      logger: this.logger,
      run: () => this.syncPage(job),
    });
  }

  private async syncPage(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const afterId = await this.cursorRepository.get(job.connectionId, cursorKey);

    this.logger.debug(
      `Executing orders.taxRate.backfill job ${job.id} for connection ${job.connectionId} ` +
        `(limit=${payload.limit}, afterId=${afterId ?? 'none'})`
    );

    try {
      const result = await this.taxRateBackfill.backfillPage({
        sourceConnectionId: job.connectionId,
        limit: payload.limit,
        afterId,
      });

      if (result.scanned > 0) {
        this.logger.log(
          `Tax-rate backfill (connection=${job.connectionId}): scanned=${result.scanned}, ` +
            `updated=${result.updated}, nextCursor=${result.nextCursor ?? 'exhausted'}`
        );
      }

      // Exhaustion (`nextCursor === null`) DELETES the cursor rather than
      // leaving the last id in place — the frontier can grow again (a
      // newly-ingested PS/WC order whose product hasn't synced yet), and a
      // stale non-null cursor would silently skip everything ahead of it on
      // the next cycle.
      if (result.nextCursor) {
        await this.cursorRepository.set(job.connectionId, cursorKey, result.nextCursor);
      } else {
        await this.cursorRepository.delete(job.connectionId, cursorKey);
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Orders tax-rate backfill failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): OrdersTaxRateBackfillPayloadV1 {
    const payload = job.payload as unknown as Partial<OrdersTaxRateBackfillPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
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
}
