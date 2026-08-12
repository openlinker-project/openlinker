/**
 * Stock At Risk Read Service Interface
 *
 * Defines the contract for the stock-at-risk "needs attention" aggregate
 * (#1983) — variants whose master stock minus the connection's configured
 * stock safety buffer (#1844) is at or below zero.
 *
 * @module libs/core/src/listings/application/services
 */
import type { StockAtRiskResult } from '../../domain/types/stock-at-risk.types';

export interface IStockAtRiskReadService {
  /**
   * Find variants listed on a connection whose master stock, minus that
   * connection's configured `stockSafetyBuffer` (#1844), is at or below
   * zero. Connections with no configured buffer (the default `0`) are
   * skipped entirely — a buffer of `0` means "no protection configured",
   * not "at risk of everything". Bounded to `limit` items.
   */
  findStockAtRisk(limit: number): Promise<StockAtRiskResult>;
}
