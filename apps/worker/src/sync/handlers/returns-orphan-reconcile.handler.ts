/**
 * Returns Orphan Reconcile Handler
 *
 * Thin delegate for jobs of type `returns.orphan.reconcile` (#2332) — the pass that
 * re-attributes an orphan return once the order it refers to has been ingested.
 *
 * The scan-offset dance lives HERE, on the handler, and reads
 * `ConnectionCursorRepositoryPort` directly — copied verbatim from
 * `MarketplaceReturnsStatusSyncHandler`, which copied it from
 * `MarketplaceOfferStatusSyncHandler` (#816). It is deliberately not
 * `ISyncCursorsService`: that seam serves the marketplace-cursor poll path, while this is
 * OL's own numeric page pointer.
 *
 * **The cursor is written only after a successful run.** A throw becomes a
 * `SyncJobExecutionError` and leaves the stored offset untouched, so a failed page is
 * retried rather than silently stepped over.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  ReturnsOrphanReconcilePayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import {
  IReturnReattributionService,
  RETURN_REATTRIBUTION_SERVICE_TOKEN,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
const DEFAULT_CURSOR_KEY = 'returns.orphanReattribution.scanOffset';

@Injectable()
export class ReturnsOrphanReconcileHandler implements SyncJobHandler {
  private readonly logger = new Logger(ReturnsOrphanReconcileHandler.name);

  constructor(
    @Inject(RETURN_REATTRIBUTION_SERVICE_TOKEN)
    private readonly reattribution: IReturnReattributionService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const cursorKey = payload.cursorKey ?? DEFAULT_CURSOR_KEY;
    const limit = payload.limit ?? DEFAULT_LIMIT;
    const storedOffset = await this.cursorRepository.get(job.connectionId, cursorKey);
    const offset = this.parseOffset(storedOffset);

    this.logger.log(
      `Executing returns.orphan.reconcile job ${job.id} for connection ${job.connectionId} (limit=${limit}, offset=${offset})`
    );

    try {
      const result = await this.reattribution.reconcile(job.connectionId, { limit, offset });

      this.logger.log(
        `returns.orphan.reconcile completed (connection=${job.connectionId}): scanned=${result.scanned}, reattributed=${result.reattributed}, alreadyAttributed=${result.alreadyAttributed}, unresolved=${result.unresolved}, failed=${result.failed}, nextOffset=${result.nextOffset}/${result.total}`
      );

      await this.cursorRepository.set(job.connectionId, cursorKey, String(result.nextOffset));

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Returns orphan reconcile failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): ReturnsOrphanReconcilePayloadV1 {
    const payload = job.payload as unknown as Partial<ReturnsOrphanReconcilePayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      limit: typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT,
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
