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
 *  1. **CLEAR, THEN STAMP, IN THAT ORDER, IN-PROCESS.** `OrderFxStampService.stamp`
 *     short-circuits on any row that already carries a figure and returns
 *     `alreadyStamped: true` without touching a provider — so stamping before
 *     the clear would just re-observe the stale figure and no-op. The reverse
 *     ordering is what makes the original live-demo bug ("we re-enqueued and
 *     nothing changed") reappear. If the process dies between the two, the row
 *     is simply left unstamped and the hourly `marketplace.order.fxStampSweep`
 *     (predicate `reportingCurrency IS NULL`) picks it up — self-healing, so
 *     no compensation is needed.
 *  2. **NO CHILD JOB, AND THEREFORE NO SEPARATE KEY SPACE — BUT ALSO NO
 *     PER-ORDER FAILURE ISOLATION FOR FREE ANY MORE.** The page used to
 *     enqueue one `marketplace.order.fxStamp` job per order into the
 *     `realtime` lane — sharing that lane's scope with live order ingestion
 *     collapses a whole connection's throughput to `perScope` slots (#2776).
 *     Calling `IOrderFxStampService.stamp` directly, sequentially, inside the
 *     already-bulk-laned `analytics.currency.recalculate` job removes the
 *     fan-out entirely: no `sync_jobs` row, no stream entry, no idempotency-
 *     key collision with `OrderFxStampService.enqueueRetry`'s bare
 *     `fx:{orderId}` to worry about — there is simply nothing left to key.
 *     One job per order also meant one order's failure could never touch
 *     another's; collapsing them into one sequential loop reopens exactly
 *     that risk, so `stampOne` guards `stamp()` the same way `clearOne`
 *     guards the clear — a caught failure counts as `failed` and the loop
 *     continues.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderFxRestatementService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_FX_STAMP_SERVICE_TOKEN, ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type {
  FxRestatementPageInput,
  FxRestatementPageResult,
  FxRestatementRemainingSummary,
} from '../../domain/types/order-fx-restatement.types';
import type { IOrderFxRestatementService } from '../interfaces/order-fx-restatement.service.interface';
import { IOrderFxStampService } from '../interfaces/order-fx-stamp.service.interface';
import type { FxStampOutcome } from '../../domain/types/order-fx-stamp.types';

@Injectable()
export class OrderFxRestatementService implements IOrderFxRestatementService {
  private readonly logger = new Logger(OrderFxRestatementService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(ORDER_FX_STAMP_SERVICE_TOKEN)
    private readonly stampService: IOrderFxStampService
  ) {}

  async restatePage(
    scope: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    page: FxRestatementPageInput
  ): Promise<FxRestatementPageResult> {
    const ids = await this.repository.findCurrencyMismatchOrderRefsAfter(
      scope,
      currentReportingCurrency,
      { afterOrderId: page.afterOrderId, limit: page.limit }
    );

    let cleared = 0;
    let stamped = 0;
    let terminal = 0;
    let deferred = 0;
    let failed = 0;

    for (const internalOrderId of ids) {
      // Sequential, not `Promise.all`: a page of foreign-currency orders on
      // distinct days is a page of provider calls, and fanning them out in
      // parallel would burst a public reference-rate API for no latency
      // benefit anyone is waiting on — the same reasoning
      // `OrderFxStampService.sweep` states for its own sequential walk.
      const didClear = await this.clearOne(internalOrderId);
      if (didClear) {
        cleared += 1;
      }

      const outcome = await this.stampOne(internalOrderId);
      switch (outcome?.kind) {
        case 'stamped':
          if (!outcome.alreadyStamped) {
            stamped += 1;
          }
          break;
        case 'terminal':
          terminal += 1;
          break;
        case 'deferred':
          deferred += 1;
          break;
        case undefined:
          failed += 1;
          break;
      }
    }

    const nextCursor = ids.length === page.limit ? ids[ids.length - 1] : null;

    this.logger.log(
      `FX restatement page: run=${page.runId} scanned=${ids.length} cleared=${cleared} ` +
        `stamped=${stamped} terminal=${terminal} deferred=${deferred} failed=${failed} ` +
        `nextCursor=${nextCursor ?? 'none'}`
    );

    return { scanned: ids.length, cleared, stamped, terminal, deferred, failed, nextCursor };
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

  /**
   * Guarded the same way `clearOne` is, for the same reason: one order's
   * failure must not abort the page. `IOrderFxStampService.stamp` is
   * documented as never throwing, but that is an implementation promise on an
   * INJECTED INTERFACE, not a type guarantee — and this page's whole point
   * was replacing N independent per-order jobs with one sequential loop, so
   * an unguarded throw here would silently abort every order still queued
   * behind it in the page (#2776 review). `undefined` (rather than folding
   * into `deferred`) is the caller's signal to count it as `failed` — an
   * unexpected fault the operator should be able to tell apart from an
   * ordinary, `stamp()`-reported retry.
   */
  private async stampOne(internalOrderId: string): Promise<FxStampOutcome | undefined> {
    try {
      return await this.stampService.stamp(internalOrderId);
    } catch (error) {
      this.logger.warn(
        `FX restatement's stamp attempt threw for order ${internalOrderId}; the hourly ` +
          `marketplace.order.fxStampSweep reconcile remains the route to a stamp: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return undefined;
    }
  }
}
