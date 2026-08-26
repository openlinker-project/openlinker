/**
 * Orders Holds Reconcile Handler (#2340, DESIGN §6.3)
 *
 * Handles `orders.holds.reconcile` — the pass that repairs
 * `order_records.activeHoldReason` against `order_holds`.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * The issue sketched this over that shape, and the properties it is after —
 * budgeted, per-run locked, never advancing past unfinished work, observable —
 * all hold here. What is NOT reused is the SCAN-OFFSET MECHANISM, and
 * `bounded-sweep.ts` draws that distinction in its own header: the sweep family
 * pages by `{limit, offset}` because its source is a stable set a run reads
 * through, whereas taxonomy uses frontier-as-query because its remaining work is
 * re-derivable from a predicate.
 *
 * This pass is unambiguously the second kind, and using the first would be a
 * correctness bug rather than a stylistic mismatch: every repair CONSUMES its
 * own selection, so an offset advancing over a shrinking set steps over rows
 * that were never repaired — silently, and visible only as an order stuck
 * reading `held`. `InventoryProvenanceBackfillHandler` (#2317) is the shipped
 * precedent for answering it this way; the sweep RESOLVERS (budget, lock TTL)
 * are reused and neither the offset machinery nor the master-scoped key
 * vocabulary is (see `orderHoldReconcileLockKey`).
 *
 * ## No latch, and that is the difference from #2317
 *
 * That backfill finishes; this pass never does — divergence can reappear at any
 * time, because the projection's authority write is best-effort by design. So
 * there is no completion stamp and no early return. Its steady-state cost is one
 * indexed query returning zero rows.
 *
 * ## Global scope
 *
 * A divergence between two OL-owned tables has no connection axis. The job runs
 * once for the deployment under the nil-UUID system connection id — the
 * `inventory.provenance.backfill` shape, including the locally-declared constant
 * (its two existing users declare it locally too, and neither `sync_jobs` nor
 * `connection_cursors` carries an FK to `connections`).
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IOrderHoldProjectionReconcileService} for the repair semantics
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OrdersHoldsReconcilePayloadV1,
  SyncJob as SyncJobEntity,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, SYNC_LOCK_TOKEN, SyncLockPort } from '@openlinker/core/sync';
import {
  ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
  type IOrderHoldProjectionReconcileService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * The nil UUID standing in for "the whole deployment, no particular connection".
 * Declared locally rather than imported because the existing users declare it
 * locally too — see `inventory-provenance-backfill.handler.ts`.
 */
const SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The lock key this pass owns.
 *
 * Declared here rather than by widening `MasterSweepKind` with a fifth member:
 * that union is the vocabulary of the MASTER catalog sweeps and their cursor
 * keys, and this pass is neither a master sweep nor cursor-bearing. Borrowing
 * the enum for its `sweepLockKey` helper would put a non-master pass into a
 * type that `@openlinker/core/sync` publishes for catalog-trust reads.
 *
 * Only the lock TTL and budget RESOLVERS are shared, which is the part that
 * genuinely generalises.
 */
function orderHoldReconcileLockKey(scopeId: string): string {
  return `orders:holds:reconcile:${scopeId}`;
}

/**
 * Rows repaired per run.
 *
 * Deliberately NOT `resolveSweepBudget`'s own default of 100. That number is
 * derived, in `bounded-sweep.ts`, from a CHILD JOB doing a full per-product
 * platform sync against an execution concurrency of 1 — arithmetic that does not
 * transfer, because this pass enqueues no children and makes no platform calls.
 * One unit of work here is a single-row conditional UPDATE against local
 * Postgres, and the divergence set is bounded by "orders currently held or
 * currently marked held", which on a healthy install is single digits.
 *
 * 500 is `SWEEP_BUDGET_MAX`, so the resolver's ceiling still applies and a
 * payload cannot widen it.
 */
const HOLD_RECONCILE_PAGE_LIMIT_DEFAULT = 500;

@Injectable()
export class OrdersHoldsReconcileHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrdersHoldsReconcileHandler.name);

  constructor(
    @Inject(ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN)
    private readonly reconcile: IOrderHoldProjectionReconcileService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId || SYSTEM_CONNECTION_ID;
    const budget = resolveSweepBudget(
      this.getPayload(job).pageLimit ?? HOLD_RECONCILE_PAGE_LIMIT_DEFAULT
    );
    const lockKey = orderHoldReconcileLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`orders.holds.reconcile skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const result = await this.reconcile.runPage(budget);

      // One structured line per tick. A cache whose repairs are invisible is a
      // cache nobody can trust, so `superseded` and `failed` are reported beside
      // `repaired` rather than folded into it — otherwise "the pass ran and
      // changed nothing" and "the pass ran and could not change anything" read
      // identically.
      if (result.examined > 0) {
        this.logger.log(
          `orders.holds.reconcile: examined ${String(result.examined)}, ` +
            `repaired ${String(result.repaired)}, ` +
            `superseded ${String(result.superseded)}, failed ${String(result.failed)}`
        );
      } else {
        this.logger.debug('orders.holds.reconcile: no divergent hold projections');
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `orders.holds.reconcile failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    } finally {
      await this.syncLock.release(lockKey, lockToken);
    }
  }

  private getPayload(job: SyncJob): Partial<OrdersHoldsReconcilePayloadV1> {
    const payload = job.payload as Partial<OrdersHoldsReconcilePayloadV1> | undefined;
    return payload ?? {};
  }
}
