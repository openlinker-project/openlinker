/**
 * Master Product Sync Batch Handler (#2593, ADR-048)
 *
 * Handles jobs of type 'master.product.syncBatch'. One job carries a PAGE of
 * external product ids and syncs them through a single adapter instance, so a
 * master declaring the bulk-read rung (`BulkProductReader`) hydrates the whole
 * page in a handful of requests instead of a handful per product. Measured on
 * PrestaShop: 100 fully-hydrated products in 3 requests.
 *
 * The batch is a REQUEST-COUNT change and nothing else. Every guard still runs
 * per product inside `IMasterProductSyncService.syncFromMasterByExternalIds`:
 * identifier mapping, variant resolution, the tax-rate journal, the #1904
 * rival-claimant prune guard, the #1599 deletion signal. Nothing was reproduced
 * here, which is the point - a guard reimplemented on a fast path is a guard
 * that drifts.
 *
 * Three properties are deliberate.
 *
 * - **A failed product does not fail the page.** The service reports failures
 *   instead of throwing, and this handler re-enqueues each failed id as an
 *   per-product `master.product.syncFromSweep` job. That keeps the per-product
 *   retry ladder and dead row the fan-out always had; failing the batch would
 *   let one poisonous product take its ninety-nine page-mates down with it, and
 *   would re-run the successes ten times on the way.
 * - **A deletion is logged, not reported as the job's outcome.** The per-product
 *   handler returns `business_failure` / `master_deleted`, which a mixed page
 *   cannot express. That costs nothing real: this path is fed by an enumeration
 *   read FROM the master, which is structurally blind to a deletion (ADR-048
 *   decision 2) - a deleted product simply stops appearing. The deletion
 *   authority is `master.product.reconcile`, which still fans out per product
 *   and still carries the label.
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
  MasterProductSyncBatchPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
} from '@openlinker/core/sync';
import {
  IMasterProductSyncService,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/products';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { propagateTaxRateChanges } from './tax-rate-propagation';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterProductSyncBatchHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncBatchHandler.name);

  constructor(
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterProductSync: IMasterProductSyncService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IdentifierMappingQueryPort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const { externalIds } = this.getPayload(job);

    this.logger.log(
      `Executing master product batch sync job ${job.id} ` +
        `(connection: ${job.connectionId}, products: ${String(externalIds.length)})`
    );

    let result;
    try {
      result = await this.masterProductSync.syncFromMasterByExternalIds(
        job.connectionId,
        externalIds
      );
    } catch (error) {
      // Only a whole-page failure reaches here - resolving the adapter, i.e. a
      // connection or credential problem that no per-product retry would fix
      // any faster. Retryable, like the per-product handler's throw.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master product batch sync failed (${String(externalIds.length)} product(s)): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }

    const deleted = result.results.filter((one) => one.masterDeleted).length;
    const rivalSkips = result.results.filter((one) => one.pruneSkippedReason === 'rival').length;
    const emptySkips = result.results.filter(
      (one) => one.pruneSkippedReason === 'empty-response'
    ).length;

    if (rivalSkips > 0) {
      // Two prune skips with completely different remediations, so they stay two
      // lines: a #1904 collision needs the operator to resolve which connection
      // owns the id, while a zero-variant response needs nothing unless it
      // persists, in which case the master is flaky (#2222).
      this.logger.warn(
        `Master product batch sync: staleness prune skipped for ${String(rivalSkips)} product(s) - ` +
          `internal product id claimed by more than one ProductMaster connection ` +
          `(job ${job.id}, connection: ${job.connectionId})`
      );
    }
    if (emptySkips > 0) {
      this.logger.warn(
        `Master product batch sync: staleness prune skipped for ${String(emptySkips)} product(s) - ` +
          `the master returned zero variants for an existing product ` +
          `(job ${job.id}, connection: ${job.connectionId})`
      );
    }
    if (deleted > 0) {
      this.logger.warn(
        `Master product batch sync: ${String(deleted)} product(s) found deleted at the master ` +
          `(job ${job.id}, connection: ${job.connectionId}); variants marked stale`
      );
    }

    // Strictly after the syncs and outside their error handling: a propagation
    // failure must not turn a completed catalogue sync into a retried one.
    for (const one of result.results) {
      await propagateTaxRateChanges(
        {
          jobEnqueue: this.jobEnqueue,
          identifierMapping: this.identifierMapping,
          logger: this.logger,
        },
        job.connectionId,
        one.taxRateChanges
      );
    }

    const requeued = await this.requeueFailures(job, result.failures);

    this.logger.log(
      `Master product batch sync done (job ${job.id}, connection: ${job.connectionId}): ` +
        `${String(result.results.length)} synced, ${String(result.failures.length)} failed ` +
        `(${String(requeued)} re-enqueued per product), prefetched=${String(result.prefetched)}`
    );

    return { outcome: 'ok' };
  }

  /**
   * Hand each failed id back to the per-product sweep job.
   *
   * `master.product.syncFromSweep`, never `master.product.syncByExternalId`: a
   * page-wide failure would otherwise put up to a page of catalogue children
   * into `realtime`, where the per-scope cap is small and the queue is shared
   * with order sync (#2594). The retry ladder and the dead row are identical;
   * only the lane differs.
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
        `Master product batch sync: product ${failure.externalId} failed, re-enqueueing per product ` +
          `(job ${job.id}, connection: ${job.connectionId}): ${failure.message}`
      );
      const request: SyncJobRequest = {
        jobType: 'master.product.syncFromSweep',
        connectionId: job.connectionId,
        payload: {
          schemaVersion: 1,
          externalId: failure.externalId,
          objectType: CORE_ENTITY_TYPE.Product,
        },
        idempotencyKey: `master:${job.connectionId}:product:sync:${failure.externalId}:batchRetry:${job.id}`,
      };
      try {
        await this.jobEnqueue.enqueueJob(request);
        requeued += 1;
      } catch (error) {
        this.logger.error(
          `Master product batch sync: could not re-enqueue product ${failure.externalId}; ` +
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
  private getPayload(job: SyncJob): MasterProductSyncBatchPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductSyncBatchPayloadV1> | null;
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
