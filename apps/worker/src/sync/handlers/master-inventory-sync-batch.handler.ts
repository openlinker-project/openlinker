/**
 * Master Inventory Sync Batch Handler (#2648, ADR-048)
 *
 * Handles jobs of type 'master.inventory.syncBatch'. One job carries a PAGE of
 * mapped product external ids and syncs their stock through a single adapter
 * instance, so a master declaring the bulk-read rung (`BulkInventoryReader`)
 * reads the whole page in a handful of requests instead of a handful per
 * product. The inventory twin of `master-product-sync-batch.handler.ts`
 * (#2593), and deliberately the same shape rather than a second mechanism.
 *
 * The batch is a REQUEST-COUNT change and nothing else. Every guard still runs
 * per product inside `IMasterInventorySyncService.syncFromMasterByExternalIds`:
 * identifier mapping, the variant-keyed write (#822/#823), the #1904
 * rival-claimant prune guard, the #1688 deletion signal. Nothing was reproduced
 * here, which is the point - a guard reimplemented on a fast path is a guard
 * that drifts.
 *
 * Three properties are deliberate, and carried over from the product side
 * because the reasoning is identical.
 *
 * - **A failed product does not fail the page.** The service reports failures
 *   instead of throwing, and this handler re-enqueues each failed id as a
 *   per-product `master.inventory.syncFromSweep` job. That keeps the
 *   per-product retry ladder and dead row the fan-out always had; failing the
 *   batch would let one poisonous product take its ninety-nine page-mates down
 *   with it, and would re-run the successes ten times on the way.
 * - **A deletion is logged, not reported as the job's outcome.** The
 *   per-product handler returns `business_failure`, which a mixed page cannot
 *   express. The deletion itself is not lost: the service already staled the
 *   rows and delegated to the products context (#2222) before returning, so the
 *   #1689 pause chain has fired by the time this line runs. Only the job LABEL
 *   is coarser.
 * - **The job is `bulk`, not `realtime` (#2594).** A sweep child arrives a whole
 *   budget wide, so its cost of starvation is the one ADR-050 assigns to bulk
 *   work: it must never take a per-scope slot in front of a buyer's order. It
 *   sits under `OL_LANE_BULK_SCOPE_CAP`, and so does the per-product child this
 *   handler falls back to on a failure.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
  MasterInventorySyncBatchPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import {
  IMasterInventorySyncService,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterInventorySyncBatchHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterInventorySyncBatchHandler.name);

  constructor(
    @Inject(MASTER_INVENTORY_SYNC_SERVICE_TOKEN)
    private readonly masterInventorySync: IMasterInventorySyncService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const { externalIds } = this.getPayload(job);

    this.logger.log(
      `Executing master inventory batch sync job ${job.id} ` +
        `(connection: ${job.connectionId}, products: ${String(externalIds.length)})`
    );

    let result;
    try {
      result = await this.masterInventorySync.syncFromMasterByExternalIds(
        job.connectionId,
        externalIds
      );
    } catch (error) {
      // Only a whole-page failure reaches here - resolving the adapter, i.e. a
      // connection or credential problem that no per-product retry would fix
      // any faster. Retryable, like the per-product handler's throw.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master inventory batch sync failed (${String(externalIds.length)} product(s)): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }

    const deleted = result.results.filter((one) => one.masterDeleted).length;
    const pruneSkips = result.results.filter((one) => one.pruneSkipped).length;

    if (pruneSkips > 0) {
      this.logger.warn(
        `Master inventory batch sync: staleness prune skipped for ${String(pruneSkips)} product(s) - ` +
          `internal product id claimed by more than one InventoryMaster connection ` +
          `(job ${job.id}, connection: ${job.connectionId})`
      );
    }
    if (deleted > 0) {
      this.logger.warn(
        `Master inventory batch sync: ${String(deleted)} product(s) found deleted at the master ` +
          `(job ${job.id}, connection: ${job.connectionId}); inventory rows marked stale`
      );
    }

    const requeued = await this.requeueFailures(job, result.failures);

    this.logger.log(
      `Master inventory batch sync done (job ${job.id}, connection: ${job.connectionId}): ` +
        `${String(result.results.length)} synced, ${String(result.failures.length)} failed ` +
        `(${String(requeued)} re-enqueued per product), prefetched=${String(result.prefetched)}`
    );

    return { outcome: 'ok' };
  }

  /**
   * Hand each failed id back to the per-product sweep job.
   *
   * `master.inventory.syncFromSweep`, never `master.inventory.syncByExternalId`:
   * a page-wide failure would otherwise put up to a page of stock children into
   * `realtime`, where the per-scope cap is small and the queue is shared with
   * order sync (#2594). The retry ladder and the dead row are identical; only
   * the lane differs.
   *
   * Keyed on the id and the attempt-free namespace `batchRetry`, so the same
   * failure in a later cycle is a fresh key: the batch job's own idempotency key
   * already stopped this page from being re-enqueued, and re-using the sweep's
   * cycle-scoped key here would dedup against the child that never ran.
   *
   * A re-enqueue that itself fails is logged and left: the product is picked up
   * by the next cycle, which is the same outcome the pre-batch fan-out had when
   * its enqueue failed.
   */
  private async requeueFailures(
    job: SyncJob,
    failures: readonly { externalId: string; message: string }[]
  ): Promise<number> {
    let requeued = 0;
    for (const failure of failures) {
      this.logger.warn(
        `Master inventory batch sync: product ${failure.externalId} failed, re-enqueueing per product ` +
          `(job ${job.id}, connection: ${job.connectionId}): ${failure.message}`
      );
      const request: SyncJobRequest = {
        jobType: 'master.inventory.syncFromSweep',
        connectionId: job.connectionId,
        payload: {
          schemaVersion: 1,
          externalId: failure.externalId,
          objectType: CORE_ENTITY_TYPE.Product,
        },
        idempotencyKey: `master:${job.connectionId}:inventory:sync:${failure.externalId}:batchRetry:${job.id}`,
      };
      try {
        await this.jobEnqueue.enqueueJob(request);
        requeued += 1;
      } catch (error) {
        this.logger.error(
          `Master inventory batch sync: could not re-enqueue product ${failure.externalId}; ` +
            `it waits for the next cycle (job ${job.id}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return requeued;
  }

  /**
   * Throws on a malformed payload, unlike the sweep handlers.
   *
   * A sweep's payload carries only an optional budget, so defaulting is better
   * than refusing to run. This payload IS the work: an empty or unreadable id
   * list would report a healthy sync of nothing.
   */
  private getPayload(job: SyncJob): MasterInventorySyncBatchPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterInventorySyncBatchPayloadV1> | null;
    const externalIds = payload?.externalIds;
    if (
      !Array.isArray(externalIds) ||
      externalIds.length === 0 ||
      externalIds.some((id) => typeof id !== 'string' || id.length === 0)
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid externalIds in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return { schemaVersion: 1, externalIds };
  }
}
