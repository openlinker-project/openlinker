/**
 * orderLineCostView - pure per-line cost/margin classification (#3588, D27)
 *
 * Same precedence as the margin SQL: no-variant, currency-mismatch,
 * cost-entered-after-sale, no-cost. No I/O.
 *
 * @module libs/core/src/orders/domain
 */
import type { MarginGapReason } from './order-line-cost-snapshot';
import type { OrderLineCostView } from './types/order-line-cost.types';

export interface ClassifyLineCostInput {
  variantId: string | null;
  costState: 'recorded' | 'not-recorded';
  unitCostNet: string | null;
  unitCostCurrency: string | null;
  orderCurrency: string | null;
  /** Whether the variant carries a cost right now. */
  variantHasCostNow: boolean;
  quantity: number;
  netAmount: number | null;
  netEligible: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function classifyLineCost(
  input: ClassifyLineCostInput
): Pick<OrderLineCostView, 'costOfGoods' | 'margin' | 'gapReason'> {
  const recorded = input.costState === 'recorded' && input.unitCostNet !== null;
  let gapReason: MarginGapReason | null = null;
  if (input.variantId === null) {
    gapReason = 'no-variant';
  } else if (recorded && input.unitCostCurrency !== input.orderCurrency) {
    gapReason = 'currency-mismatch';
  } else if (!recorded) {
    gapReason = input.variantHasCostNow ? 'cost-entered-after-sale' : 'no-cost';
  }

  const covered =
    gapReason === null && recorded && input.netEligible && input.netAmount !== null;
  if (!covered) {
    return { costOfGoods: null, margin: null, gapReason };
  }
  const costOfGoods = round2(Number(input.unitCostNet) * input.quantity);
  return { costOfGoods, margin: round2((input.netAmount as number) - costOfGoods), gapReason };
}
