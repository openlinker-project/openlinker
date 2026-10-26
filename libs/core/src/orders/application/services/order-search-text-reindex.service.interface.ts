/**
 * Order Search Text Reindex Service Interface (#3507 G03-14)
 *
 * The seam the worker's `maintenance` role calls to bring stored
 * `order_records.searchText` values in line with the install's CURRENT PII
 * mode. Scheduling, leasing and resume-cursor bookkeeping stay with the
 * caller — this seam does one budgeted pass.
 *
 * @module libs/core/src/orders/application/services
 */
import type { OrderSearchTextReindexRunResult } from '../../domain/types/order-search-text-reindex.types';

export interface IOrderSearchTextReindexService {
  /**
   * One budgeted pass, resuming after `afterInternalOrderId` (or from the
   * start when `null`). Idempotent: a row whose stored text already equals
   * the derivation is read but never written, so a second pass over a clean
   * table writes nothing.
   */
  runOnce(afterInternalOrderId: string | null): Promise<OrderSearchTextReindexRunResult>;
}
