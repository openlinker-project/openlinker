/**
 * Inventory Sale-Decrement Reconcile Sweep Handler (#3629, epic #3460)
 *
 * Handles `inventory.saleDecrement.reconcileSweep` - one budgeted, per-run-locked
 * pass that enqueues `inventory.saleDecrement` for routed works whose decrement
 * job was never enqueued.
 *
 * ## Why this exists
 *
 * With the OMS on, a routed order is never created in the product master, so
 * `inventory.saleDecrement` is the only thing that lowers its stock. Both
 * producers (`OrderIngestionService`'s routing intercept and
 * `FulfillmentWorkRouteHandler`) swallow an enqueue failure by design - the
 * intercept is fail-open, and escaping it would mirror an order whose work rows
 * are already committed. The job has no cron, and a retry of `route()` answers
 * `already-routed` without reaching an enqueue, so a lost enqueue leaves the
 * master's stock high for ever: the very oversell #3453 closes, reached through
 * the one path left open.
 *
 * ## The frontier
 *
 * A routed work on a live order with NO `sync_jobs` row under the producers' own
 * idempotency key (`inventory:sale-decrement:{workId}`), past a grace window and
 * inside a lookback window. The lookback is NOT optional: `sync_jobs` is pruned
 * (#2946), so without a floor a pruned row would make an old, correctly
 * decremented work look lost, and every work routed before the decrement job
 * existed would lower the master's stock on first deploy.
 * Deliberately not "a line with no `inventory_sale_decrements` row": lines that
 * legitimately never get a row (an item missing from the snapshot, a
 * non-positive quantity) would sit on that frontier and be re-driven every tick
 * for ever. A candidate leaves the set by being enqueued, so this is
 * frontier-as-query with no cursor and no `runBoundedSweep` - an advancing offset
 * over a shrinking set steps over rows, which here means a sale never lowered.
 *
 * Enqueueing under the SAME key means a race with a slow original enqueue is a
 * harmless `isExisting: true`. A job that was enqueued and then died is NOT
 * covered: it is an operator-visible dead job, and re-driving it here would loop.
 *
 * ## Lane and scope
 *
 * `bulk` (ADR-050): cron-paced reconciliation, not a buyer-facing path - the
 * decrement job itself stays `realtime`. Global scope under the nil-UUID system
 * connection id; the CHILD jobs carry the order's source connection (#2609).
 * Its own lock key, not `sweepLockKey`, which names a master this pass lacks.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IFulfillmentSaleDecrementReconcileService} for the frontier
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FULFILLMENT_SALE_DECREMENT_RECONCILE_SERVICE_TOKEN,
  resolveSaleDecrementReconcileGraceMs,
  resolveSaleDecrementReconcileLookbackMs,
  type IFulfillmentSaleDecrementReconcileService,
} from '@openlinker/core/fulfillment';
import type {
  InventorySaleDecrementReconcileSweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type JobEnqueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * Candidates examined per run - DERIVED, not copied. One unit is one local
 * `sync_jobs` insert (no platform call, no adapter), cheaper than the relay
 * sweep's lifecycle fan-out (25), so 50; a backlog is drained by widening ONE run
 * through the payload's `pageLimit`, never by moving this number.
 */
export const INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_DEFAULT = 50;

const INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_MAX = 500;

/** This pass's own lock namespace. */
export function inventorySaleDecrementReconcileLockKey(scopeId: string): string {
  return `inventory:sale-decrement:reconcile-sweep:${scopeId}`;
}

@Injectable()
export class InventorySaleDecrementReconcileSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(InventorySaleDecrementReconcileSweepHandler.name);

  constructor(
    @Inject(FULFILLMENT_SALE_DECREMENT_RECONCILE_SERVICE_TOKEN)
    private readonly reconcile: IFulfillmentSaleDecrementReconcileService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(this.getPageLimit(job), {
      default: INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_DEFAULT,
      max: INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_MAX,
    });
    const graceMs = resolveSaleDecrementReconcileGraceMs(
      this.configService.get<string>('OL_SALE_DECREMENT_RECONCILE_GRACE_MS')
    );
    const lookbackMs = resolveSaleDecrementReconcileLookbackMs(
      this.configService.get<string>('OL_SALE_DECREMENT_RECONCILE_LOOKBACK_MS')
    );
    const lockKey = inventorySaleDecrementReconcileLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_SALE_DECREMENT_RECONCILE_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`inventory.saleDecrement.reconcileSweep skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const page = await this.reconcile.listWorksMissingSaleDecrementJob({
        limit,
        graceMs,
        lookbackMs,
        now: new Date(),
      });

      let enqueued = 0;
      let alreadyQueued = 0;
      let failed = 0;

      // Sequential: one local insert each, and a per-candidate failure must not
      // abort a page whose other candidates are re-drivable.
      for (const candidate of page.candidates) {
        try {
          const result = await this.jobEnqueue.enqueueJob({
            jobType: 'inventory.saleDecrement',
            connectionId: candidate.connectionId,
            payload: { schemaVersion: 1, orderId: candidate.orderId, workId: candidate.workId },
            idempotencyKey: candidate.dedupeKey,
          });
          if (result.isExisting) {
            alreadyQueued += 1;
          } else {
            enqueued += 1;
            this.logger.warn(
              `sale_decrement_reconcile_recovered: work ${candidate.workId} ` +
                `(order ${candidate.orderId}) had no decrement job; enqueued one`
            );
          }
        } catch (error) {
          failed += 1;
          this.logger.error(
            `Failed to enqueue the sale decrement for work ${candidate.workId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (page.candidates.length > 0 && failed === page.candidates.length) {
        // Oldest-first with no cursor: enough permanently failing candidates fill
        // the page and starve the rest, so the condition is SURFACED.
        this.logger.error(
          `sale_decrement_reconcile_page_all_failed: none of ${String(page.candidates.length)} ` +
            `candidate(s) could be enqueued; the oldest will be re-read next tick`
        );
      }

      this.logger.log(
        `inventory.saleDecrement.reconcileSweep: examined=${String(page.candidates.length)}, ` +
          `enqueued=${String(enqueued)}, alreadyQueued=${String(alreadyQueued)}, ` +
          `failed=${String(failed)}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is persisted by this pass itself - there is no cursor - so a failed
      // run leaves every candidate where it was and the next tick re-reads them.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `inventory.saleDecrement.reconcileSweep failed: ${message}`,
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
          `Failed to release ${lockKey}: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`
        );
      }
    }
  }

  /** `pageLimit` off the payload when present; runtime-checked (jsonb). */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as
      | Partial<InventorySaleDecrementReconcileSweepPayloadV1>
      | null
      | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}
