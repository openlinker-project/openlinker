/**
 * Marketplace Returns Status Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'marketplace.returns.statusSync' (#2330) —
 * pass 2, the bounded re-read that is the only way OL ever observes a return
 * moving. Refreshes one page of a connection's non-terminal returns and persists
 * the rolling scan offset so the next run continues where this one stopped.
 *
 * The scan-offset dance lives HERE, on the handler, and reads
 * `ConnectionCursorRepositoryPort` directly — copied from
 * `MarketplaceOfferStatusSyncHandler` (#816), which is also why it does not use
 * `ISyncCursorsService`: that seam serves the marketplace-cursor poll path,
 * while this is OL's own numeric page pointer. Keeping the two on the same
 * mechanism as their respective siblings is what makes either one legible.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceReturnsStatusSyncPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import {
  IReturnStatusSyncService,
  RETURN_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 50;
const DEFAULT_CURSOR_KEY = 'allegro.customerReturns.scanOffset';
/** See `ReturnSourceSweepFilter.openedSince` for why this is never unbounded. */
const DEFAULT_LOOKBACK_DAYS = 90;

@Injectable()
export class MarketplaceReturnsStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceReturnsStatusSyncHandler.name);

  constructor(
    @Inject(RETURN_STATUS_SYNC_SERVICE_TOKEN)
    private readonly returnStatusSync: IReturnStatusSyncService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const storedOffset = await this.cursorRepository.get(job.connectionId, cursorKey);
    const offset = this.parseOffset(storedOffset);

    this.logger.log(
      `Executing marketplace.returns.statusSync job ${job.id} for connection ${job.connectionId} (limit=${payload.limit}, offset=${offset}, lookbackDays=${payload.lookbackDays})`
    );

    try {
      const result = await this.returnStatusSync.sync(job.connectionId, {
        limit: payload.limit,
        offset,
        lookbackDays: payload.lookbackDays,
      });

      this.logger.log(
        `marketplace.returns.statusSync completed (connection=${job.connectionId}): scanned=${result.scanned}, updated=${result.updated}, attributed=${result.attributed}, orphaned=${result.orphaned}, notFound=${result.notFound}, failed=${result.failed}, nextOffset=${result.nextOffset}/${result.total}, terminalVocabularyDeclared=${result.terminalVocabularyDeclared}`
      );

      await this.cursorRepository.set(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace returns status sync failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceReturnsStatusSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceReturnsStatusSyncPayloadV1>;
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
    const lookbackDays =
      typeof payload.lookbackDays === 'number' && payload.lookbackDays > 0
        ? payload.lookbackDays
        : DEFAULT_LOOKBACK_DAYS;
    return {
      schemaVersion: 1,
      limit,
      cursorKey: typeof payload.cursorKey === 'string' ? payload.cursorKey : undefined,
      lookbackDays,
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
