/**
 * Tax Rate Backfill Service Interface
 *
 * Contract for the tax-rate backfill sweep (#2440): fill `taxRate` on a
 * historical `order_line_items` row that predates the per-line tax-rate epic
 * (#2245) from the CURRENT catalogue rate, so old orders can enter a net
 * revenue figure without a fabricated rate.
 *
 * @module libs/core/src/orders/application/services
 */

export interface TaxRateBackfillPageInput {
  sourceConnectionId: string;
  /** Page size. */
  limit: number;
  /** Resume point from a prior page, or `null` to start from the beginning. */
  afterId: string | null;
}

export interface TaxRateBackfillPageResult {
  /** Rows read this page. */
  scanned: number;
  /** Rows whose rate the catalogue could resolve and that were written. */
  updated: number;
  /**
   * Cursor for the next page — the last scanned row's id, or `null` when the
   * page was shorter than `limit` (the connection's rate-less frontier is
   * exhausted for now).
   */
  nextCursor: string | null;
}

/** What one on-demand, order-scoped backfill request did. */
export interface TaxRateBackfillOrdersResult {
  /** Rate-less lines examined across every requested order. */
  scanned: number;
  /** Of those, lines the current catalogue resolved a rate for and that were written. */
  updated: number;
}

export interface ITaxRateBackfillService {
  /**
   * Backfill one page of one connection's rate-less lines. Never throws for
   * an individual line's unresolved rate — that row is simply left for a
   * later run, once the catalogue itself carries a rate.
   */
  backfillPage(input: TaxRateBackfillPageInput): Promise<TaxRateBackfillPageResult>;

  /**
   * Run the SAME per-line resolution the scheduled sweep runs, but for an
   * explicit set of orders (#2469) — the Data Coverage panel's category-C
   * "re-run backfill now" action.
   *
   * This is not a second mechanism, it is the existing one triggered early: an
   * operator staring at a large category-C count should not have to wait for the
   * connection's next scheduled tick. Because the resolution is idempotent and
   * only ever writes a rate where the catalogue now HAS one, the action needs no
   * `analytics_remediation_runs` row, no lifecycle and nothing to poll — a
   * repeat request is free and there is no state that can be left "in progress".
   *
   * Only rate-less lines are touched; a line whose rate the catalogue still
   * cannot resolve is left for a later run, exactly as in the sweep. Never
   * throws for one unresolvable line or one failed catalogue read.
   */
  backfillOrders(internalOrderIds: string[]): Promise<TaxRateBackfillOrdersResult>;
}
