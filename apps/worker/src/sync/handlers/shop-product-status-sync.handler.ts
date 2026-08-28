/**
 * Shop Product Status Sync Handler (#1845)
 *
 * Thin delegate for jobs of type `shop.product.statusSync`. Reconciles one page
 * of a connection's published/draft products via core `ShopStatusSyncService`
 * and persists the rolling scan offset on the connection cursor so the next run
 * continues where this one stopped. The shop-side sibling of
 * `MarketplaceOfferStatusSyncHandler`.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  ShopProductStatusSyncPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import { IShopStatusSyncService, SHOP_STATUS_SYNC_SERVICE_TOKEN } from '@openlinker/core/listings';
import { ConfigService } from '@nestjs/config';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { resolveScanSweepLockTtlMs, runExclusiveScanSweep } from '../scan-sweep-lock';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
const DEFAULT_CURSOR_KEY = 'shop.productStatus.scanOffset';

@Injectable()
export class ShopProductStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(ShopProductStatusSyncHandler.name);

  constructor(
    @Inject(SHOP_STATUS_SYNC_SERVICE_TOKEN)
    private readonly shopStatusSync: IShopStatusSyncService,
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
      kind: 'shop-product-status',
      connectionId: job.connectionId,
      lockTtlMs: resolveScanSweepLockTtlMs(
        this.configService.get<string>('OL_SCAN_SWEEP_LOCK_TTL_MS')
      ),
      jobType: 'shop.product.statusSync',
      logger: this.logger,
      run: () => this.syncPage(job),
    });
  }

  private async syncPage(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const storedOffset = await this.cursorRepository.get(job.connectionId, cursorKey);
    const offset = this.parseOffset(storedOffset);

    this.logger.log(
      `Executing shop.product.statusSync job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, offset=${offset})`,
    );

    try {
      const result = await this.shopStatusSync.sync(job.connectionId, {
        limit: payload.limit ?? DEFAULT_LIMIT,
        offset,
      });

      this.logger.log(
        `shop.product.statusSync completed (connection=${job.connectionId}): scanned=${result.scanned}, updated=${result.updated}, transitioned=${result.transitioned}, removed=${result.removed}, nextOffset=${result.nextOffset}/${result.total}`,
      );

      await this.cursorRepository.set(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Shop product status sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): ShopProductStatusSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<ShopProductStatusSyncPayloadV1>;
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
