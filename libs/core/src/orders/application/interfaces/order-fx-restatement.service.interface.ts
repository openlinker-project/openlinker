/**
 * Order FX Restatement Service Interface
 *
 * The seam behind the Data Coverage panel's "Recalculate all N now" currency
 * action (#2468, epic #2452 Phase 5) — the ONE path in the system that clears
 * an ADR-040 FX stamp so the stamp pipeline can re-answer the order.
 *
 * Consumed by the `analytics.currency.recalculate` worker handler, never from
 * an HTTP request thread: the repair is a bulk, per-order, provider-touching
 * job, so the API only opens the audit-ledger row and enqueues the driver.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type {
  FxRestatementPageInput,
  FxRestatementPageResult,
  FxRestatementRemainingSummary,
} from '../../domain/types/order-fx-restatement.types';

export interface IOrderFxRestatementService {
  /**
   * Clear + re-stamp one bounded page of the mismatched population in
   * `scope`, in-process and sequentially — no child job is enqueued.
   *
   * `scope` is the SAME `SalesAnalyticsFilters` the coverage detector counted
   * over, so the repair can never be wider than the figure the operator
   * authorised. Never throws for one bad order: a per-order failure is logged
   * and the page continues, exactly as `OrderFxStampService.sweep` does, so
   * one row cannot abort a restatement.
   */
  restatePage(
    scope: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    page: FxRestatementPageInput
  ): Promise<FxRestatementPageResult>;

  /**
   * How much of `scope` is still mismatched, split by whether the FX pipeline
   * already reached a terminal answer.
   *
   * This is the run's completion signal, and it is LEVEL-TRIGGERED on purpose:
   * the handler re-reads the population rather than counting down enqueued
   * children. A counter would need its own table, could double-count a
   * re-delivered job, and would still be wrong whenever the population shifted
   * under it — whereas "is anything left in scope?" is the question the panel
   * itself asks and is restart-safe because all of its state is the rows.
   */
  countRemaining(
    scope: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<FxRestatementRemainingSummary>;
}
