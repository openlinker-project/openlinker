/**
 * Order Line Cost Service Interface (#3588, D27)
 *
 * Per-line cost at order time and margin for one order (mockup M30 `order-line`).
 *
 * @module libs/core/src/orders/application/services
 */
import type { OrderLineCostsResult } from '../../domain/types/order-line-cost.types';

export interface IOrderLineCostService {
  /** `null` when the order does not exist; `{lines: []}` for an order with no line rows. */
  getLineCosts(
    internalOrderId: string,
    includeBackfilledPreRollout?: boolean
  ): Promise<OrderLineCostsResult | null>;
}
