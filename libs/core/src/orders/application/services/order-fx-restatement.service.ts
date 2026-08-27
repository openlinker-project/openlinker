/**
 * Order FX Restatement Service
 *
 * Implements the operator-triggered currency restatement behind the Data
 * Coverage panel's "Recalculate all N now" action (#2468, epic #2452 Phase 5).
 *
 * ADR-040 STATES THE FX STAMP IS IMMUTABLE — "a row that carries a figure is
 * never re-entered" — and this service is the documented exception to that
 * rule. It is acceptable for one reason: it only ever runs inside an
 * `analytics_remediation_runs` ledger row, which records who asked, when, and
 * over how many orders. A restated financial figure that nobody can trace back
 * to a request is the thing ADR-040's rule exists to prevent; a restated figure
 * with a durable audit row attached is a different act. Anything that widens
 * this service's reach — a scope that is not the operator's own, a caller that
 * is not the run handler — reopens the problem, so both are constraints of the
 * contract rather than incidental facts about today's call sites.
 *
 * Two mechanics carry the whole thing, and both were live traps before they
 * were rules:
 *
 *  1. **CLEAR, THEN ENQUEUE, IN THAT ORDER.** `OrderFxStampService.stamp`
 *     short-circuits on any row that already carries a figure and returns
 *     `alreadyStamped: true` without touching a provider — so a stamp job
 *     enqueued before the clear can legitimately run first, find the stale
 *     stamp still present, and no-op. The reverse ordering is what makes the
 *     original live-demo bug ("we re-enqueued and nothing changed") reappear.
 *     If the process dies between the two, the row is simply left unstamped and
 *     the hourly `marketplace.order.fxStampSweep` (predicate
 *     `reportingCurrency IS NULL`) picks it up — self-healing, so no
 *     compensation is needed.
 *  2. **A WAVE-DISTINCT IDEMPOTENCY KEY.** `sync_jobs.idempotencyKey` is
 *     globally unique with no TTL and `OrderFxStampService.enqueueRetry`
 *     already spent the bare `fx:{orderId}` for any order that ever degraded
 *     to a retry. Re-using it here returns that long-dead row and enqueues
 *     nothing, silently. See `buildFxRestatementIdempotencyKey`.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderFxRestatementService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { JOB_ENQUEUE_TOKEN, JobEnqueuePort } from '@openlinker/core/sync';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import {
  buildFxRestatementIdempotencyKey,
  type FxRestatementOrderRef,
  type FxRestatementPageInput,
  type FxRestatementPageResult,
  type FxRestatementRemainingSummary,
} from '../../domain/types/order-fx-restatement.types';
import type { IOrderFxRestatementService } from '../interfaces/order-fx-restatement.service.interface';

@Injectable()
export class OrderFxRestatementService implements IOrderFxRestatementService {
  private readonly logger = new Logger(OrderFxRestatementService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async restatePage(
    scope: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    page: FxRestatementPageInput
  ): Promise<FxRestatementPageResult> {
    const refs = await this.repository.findCurrencyMismatchOrderRefsAfter(
      scope,
      currentReportingCurrency,
      { afterOrderId: page.afterOrderId, limit: page.limit }
    );

    let cleared = 0;
    let enqueued = 0;

    for (const ref of refs) {
      // Sequential, not `Promise.all`: each iteration is a write plus an
      // enqueue, and the two must stay ordered PER ORDER (see the class doc).
      // Fanning the page out would also burst the job queue for no latency
      // benefit — nothing is waiting on this call.
      const didClear = await this.clearOne(ref.internalOrderId);
      if (didClear) {
        cleared += 1;
      }
      const didEnqueue = await this.enqueueOne(page.runId, ref);
      if (didEnqueue) {
        enqueued += 1;
      }
    }

    const nextCursor = refs.length === page.limit ? refs[refs.length - 1].internalOrderId : null;

    this.logger.log(
      `FX restatement page: run=${page.runId} scanned=${refs.length} cleared=${cleared} ` +
        `enqueued=${enqueued} nextCursor=${nextCursor ?? 'none'}`
    );

    return { scanned: refs.length, cleared, enqueued, nextCursor };
  }

  async countRemaining(
    scope: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<FxRestatementRemainingSummary> {
    return this.repository.countRemainingCurrencyMismatch(scope, currentReportingCurrency);
  }

  /**
   * Best-effort per order. A clear that throws must not abort the page: the
   * remaining orders are independent repairs, and the run's completion poll
   * re-reads the population anyway, so a skipped order shows up there rather
   * than being silently declared fixed.
   */
  private async clearOne(internalOrderId: string): Promise<boolean> {
    try {
      return await this.repository.clearFxStampForRestatement(internalOrderId);
    } catch (error) {
      this.logger.warn(
        `FX restatement could not clear the stamp on order ${internalOrderId}: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  private async enqueueOne(runId: string, ref: FxRestatementOrderRef): Promise<boolean> {
    const internalOrderId = ref.internalOrderId;
    const request: SyncJobRequest = {
      jobType: 'marketplace.order.fxStamp',
      // The order's OWN source connection, exactly as
      // `OrderFxStampService.enqueueRetry` does — `SyncJob.connectionId` is
      // non-nullable while the stamp itself is connection-agnostic, and this
      // is also the connection the hourly reconcile sweep is scoped to, so a
      // job the restatement failed to enqueue is still reachable there. The
      // enumeration already carries the value, so no extra read is paid for it.
      connectionId: ref.sourceConnectionId,
      payload: { schemaVersion: 1, internalOrderId },
      idempotencyKey: buildFxRestatementIdempotencyKey(runId, internalOrderId),
    };

    try {
      await this.jobEnqueue.enqueueJob(request);
      return true;
    } catch (error) {
      // Logged rather than thrown for the same reason the clear is: the run's
      // completion poll is the authority on whether the scope is clear, and the
      // hourly reconcile sweep still reaches a cleared-but-unenqueued row.
      this.logger.warn(
        `FX restatement could not enqueue a stamp job for order ${internalOrderId} ` +
          `(run ${runId}); the hourly reconcile sweep remains the route to a stamp: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }
}
