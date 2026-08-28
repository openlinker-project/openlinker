/**
 * Master Inventory Sync All Handler
 *
 * Handles jobs of type 'master.inventory.syncAll'. Enumerates known product
 * external IDs for a connection and enqueues 'master.inventory.syncBatch'
 * sub-jobs, each covering a page of products (#2648 - it used to fan out one
 * 'master.inventory.syncFromSweep' per product, which built a fresh adapter
 * instance per product and so could never share a bulk stock read; measured at
 * 100 requests per 100 stock positions).
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
  OPERATIONAL_SETTING_BOUNDS,
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type IOperationalSettingsService,
  type OperationalSettingsView,
} from '@openlinker/core/operational-settings';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import {
  SWEEP_BATCH_SIZE_DEFAULT,
  SWEEP_BATCH_SIZE_MAX,
  SWEEP_BUDGET_DEFAULT,
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
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly operationalSettings: IOperationalSettingsService,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    // Deliberately still the per-item budget (100), NOT the product sweep's
    // batched 500. #2648 makes the CHILD cheap; choosing what the run may then
    // afford is a separate decision, taken together with the same question for
    // the deletion audit and with a measurement to back it. So this run still
    // covers the same 100 products it covered before - in one child issuing a
    // handful of requests instead of a hundred children issuing one each.
    //
    // What the run may afford is now the OPERATOR's answer rather than a
    // constant (#2651), resolved per tick so a change needs no restart. The
    // default is unchanged at 100, so an install that sets nothing sweeps
    // exactly the same 100 products it swept before.
    const settings = await this.operationalSettings.resolve();
    const budget = resolveSweepBudget(
      this.getPayload(job).pageLimit ?? settings.inventorySweepBudget.value,
      // The ceiling is the SETTINGS bound, not `SWEEP_BUDGET_MAX`: an operator
      // told 2000 is accepted must not have it silently clamped to 500 here.
      { default: SWEEP_BUDGET_DEFAULT, max: OPERATIONAL_SETTING_BOUNDS.inventorySweepBudget.max }
    );
    const batchSize = this.getBatchSize(settings);
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
        groupSize: batchSize,
        enqueue: (externalIds, cycleId) => this.enqueueChild(job, externalIds, cycleId),
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

  /**
   * Enqueue one child covering a whole batch of products (#2648).
   *
   * The child is `master.inventory.syncBatch`, not one
   * `master.inventory.syncFromSweep` per id: a per-product child builds its own
   * adapter instance, so it cannot benefit from a bulk read no matter how cheap
   * the read is. The per-product job survives as the fallback for a failed
   * batch member and as the webhook-driven path's sweep twin.
   */
  private async enqueueChild(
    job: SyncJob,
    externalIds: readonly string[],
    cycleId: string
  ): Promise<unknown> {
    const jobRequest: SyncJobRequest = {
      jobType: 'master.inventory.syncBatch',
      connectionId: job.connectionId,
      payload: {
        schemaVersion: 1,
        externalIds: [...externalIds],
      },
      // Keyed on the CYCLE and on the batch's FIRST id, exactly as the product
      // sweep is: a resuming tick is a different job, so a job-scoped key would
      // re-enqueue the same child under a fresh key on every overlapping page.
      // Cycle-scoping also makes a crash between enqueue and cursor write safe -
      // the retry produces identical keys, since the same offset yields the
      // same batch boundaries.
      idempotencyKey: `master:${job.connectionId}:inventory:syncBatch:${externalIds[0]}:${cycleId}`,
    };
    return this.jobEnqueue.enqueueJob(jobRequest);
  }

  /**
   * Products per batch child, clamped to PrestaShop's own collection page.
   *
   * `OL_INVENTORY_SYNC_BATCH_SIZE` survives as a narrower, sweep-specific
   * override consulted only while no operator has set the shared page size -
   * see the product sweep's twin for why collapsing the two would be a silent
   * behaviour change on upgrade.
   */
  private getBatchSize(settings: OperationalSettingsView): number {
    if (settings.sweepPageSize.source === 'setting') {
      return settings.sweepPageSize.value;
    }
    const raw = this.configService.get<string>(
      'OL_INVENTORY_SYNC_BATCH_SIZE',
      String(settings.sweepPageSize.value)
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return SWEEP_BATCH_SIZE_DEFAULT;
    return Math.min(Math.floor(parsed), SWEEP_BATCH_SIZE_MAX);
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
