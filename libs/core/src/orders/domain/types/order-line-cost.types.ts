/**
 * Order Line Cost Types (#3588, D27, mockup M30 state `order-line`)
 *
 * The per-line "cost at order time" and margin of ONE order, shown on the order
 * detail items table. Amounts are in the ORDER's native currency (not the
 * reporting currency the analytics margin reads use): the operator is looking
 * at one order, and G11-C keeps a cost in a different currency out of margin.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { LineCostState, MarginGapReason } from '../order-line-cost-snapshot';

export interface OrderLineCostView {
  lineNumber: number;
  productId: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  /** VAT-exclusive line revenue in the order currency; `null` when no net figure is derivable. */
  netAmount: number | null;
  costState: LineCostState;
  unitCostNet: string | null;
  unitCostCurrency: string | null;
  /** `unitCostNet * quantity` when recorded in the order currency, else `null`. `0` is a real cost. */
  costOfGoods: number | null;
  /** `netAmount - costOfGoods`, `null` unless the line is covered. */
  margin: number | null;
  gapReason: MarginGapReason | null;
  /** Whether the line counts in Net Sales at all (same rule as the analytics figures). */
  netEligible: boolean;
}

export interface OrderLineCostsResult {
  currency: string | null;
  lines: OrderLineCostView[];
}
