/**
 * Master Inventory Sync All Handler
 *
 * Handles jobs of type 'master.inventory.syncAll'. Enumerates known product
 * external IDs for a connection and enqueues per-product
 * 'master.inventory.syncFromSweep' sub-jobs.
 *
 * BOUNDED AND RESUMABLE since #2219 (ADR-048 decisions 4-6) — same shape as the
 * product sweep (`runBoundedSweep`), with one difference that matters: this sweep
 * does not read the platform at all. It enumerates OL's own identifier mappings,
 * which until #2219 was a bare unbounded `find({ entityType, connectionId })` —
 * every mapped product row for the connection loaded into memory every 15 minutes,
 * then fanned out one child per row with no cap.
 *
 * **This sweep carries more weight than it looks.** `inventory.propagateToMarketplaces`
 * has no cron of its own — it fires from `InventoryService.setInventory` when a
 * quantity actually changed — so on a master with no stock webhook (WooCommerce,
 * whose translator handles only `order`) this is the ONLY thing that discovers
 * stock drift. It is paced, deliberately not slowed to a crawl, and never disabled.
 *
 * Stock is not on the catalog's modified-since rung on either shipped master
 * (ADR-048 decision 7), so this stays a full enumeration; a delta path is #2220.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link runBoundedSweep} for the shared shape, also used by the product sweep
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
  MasterInventorySyncAllPayloadV1
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,

  ISyncCursorsService,
  SyncLockPort} from '@openlinker/core/sync';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import {
  formatSweepCursor,
  parseSweepCursor,
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  runBoundedSweep,
  sweepCursorKey,
  sweepLockKey,
  readMappingPage,
} from '../bounded-sweep';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterInventorySyncAllHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterInventorySyncAllHandler.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IdentifierMappingQueryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const budget = resolveSweepBudget(this.getPayload(job).pageLimit);
    const lockKey = sweepLockKey('inventory', job.connectionId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(
        `master.inventory.syncAll skipped for connection ${job.connectionId}: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const cursorKey = sweepCursorKey('inventory', job.connectionId);
      const cursor = parseSweepCursor(await this.cursors.getCursor(job.connectionId, cursorKey));

      const result = await runBoundedSweep({
        cursor,
        budget,
        readPage: (offset, pageBudget) =>
          readMappingPage(
            (page) =>
              this.identifierMapping.listExternalIdsByConnection(
                CORE_ENTITY_TYPE.Product,
                job.connectionId,
                page
              ),
            offset,
            pageBudget
          ),
        // One id per child: this sweep keeps the per-item fan-out.
        enqueue: (externalIds, cycleId) => this.enqueueChild(job, externalIds[0], cycleId),
        newCycleId: () => randomUUID(),
      });

      await this.cursors.advanceCursor(
        job.connectionId,
        cursorKey,
        result.nextCursor === null ? '' : formatSweepCursor(result.nextCursor)
      );

      if (result.failed > 0) {
        this.logger.error(
          `master.inventory.syncAll for connection ${job.connectionId}: ${result.enqueued} enqueued, ` +
            `${result.failed} failed; cursor held at offset ${String(result.nextCursor?.offset ?? 0)} so the page retries next tick`
        );
      } else {
        this.logger.log(
          `master.inventory.syncAll for connection ${job.connectionId}: ${result.enqueued} inventory sync job(s) enqueued ` +
            `(cycle ${result.cycleId}, ${result.completed ? 'cycle complete' : `resuming at offset ${String(result.nextCursor?.offset ?? 0)}`})`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.inventory.syncAll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    } finally {
      try {
        await this.syncLock.release(lockKey, lockToken);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release ${lockKey}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  private async enqueueChild(job: SyncJob, externalId: string, cycleId: string): Promise<unknown> {
    const jobRequest: SyncJobRequest = {
      // Sweep-triggered child: same handler and payload as the
      // webhook-driven `master.inventory.syncByExternalId`, distinct type so
      // ADR-050 can lane it by its own cost of starvation (#2594).
      jobType: 'master.inventory.syncFromSweep',
      connectionId: job.connectionId,
      payload: {
        schemaVersion: 1,
        externalId,
        objectType: CORE_ENTITY_TYPE.Product,
      },
      // Cycle-scoped, not job-scoped — see the product sweep's note.
      idempotencyKey: `master:${job.connectionId}:inventory:sync:${externalId}:${cycleId}`,
    };
    return this.jobEnqueue.enqueueJob(jobRequest);
  }

  /**
   * Defaults rather than throwing on a malformed payload, unlike the taxonomy
   * handler this pattern otherwise follows (`destination-taxonomy-sync.handler.ts`
   * raises on a missing payload). A sweep's payload carries nothing the run needs
   * — only an optional budget override — so refusing to run a scheduled sweep
   * over a malformed one would trade a healthy default for a dead job.
   */
  private getPayload(job: SyncJob): MasterInventorySyncAllPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterInventorySyncAllPayloadV1> | null;
    return {
      schemaVersion: 1,
      pageLimit:
        payload && typeof payload.pageLimit === 'number' ? payload.pageLimit : undefined,
    };
  }
}
