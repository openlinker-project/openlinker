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

export interface ITaxRateBackfillService {
  /**
   * Backfill one page of one connection's rate-less lines. Never throws for
   * an individual line's unresolved rate — that row is simply left for a
   * later run, once the catalogue itself carries a rate.
   */
  backfillPage(input: TaxRateBackfillPageInput): Promise<TaxRateBackfillPageResult>;
}
