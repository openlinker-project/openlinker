/**
 * Gift rule results (#3935)
 *
 * What the 30-day gift report says about gifts the promotions gave: units,
 * orders and cost. The report groups per rule, product and currency, so the
 * figures are summed here and the cost stays split per currency, never added
 * across them. A `null` rule id means every promotion.
 *
 * `orders` adds the per-group order counts: an order that received two different
 * gifts counts once per gift, so the figure is the number of gift-carrying
 * order lines, not of distinct orders.
 *
 * @module apps/web/src/features/promotions/lib
 */
import type { GiftReportGroup } from '../../gift-report';

export interface GiftResultCost {
  currency: string | null;
  costNet: number;
}

export interface PromotionResults {
  units: number;
  orders: number;
  costs: GiftResultCost[];
  unknownCostUnits: number;
}

export function summarisePromotionResults(
  groups: readonly GiftReportGroup[],
  promotionId: string | null,
): PromotionResults {
  const costs = new Map<string | null, number>();
  const results: PromotionResults = { units: 0, orders: 0, costs: [], unknownCostUnits: 0 };
  for (const group of groups) {
    // The group carries the line's own source (`ol-rule`); `rule` is only the report's coarse filter value.
    if (group.giftSource !== 'ol-rule') continue;
    if (promotionId !== null && group.ruleRef !== promotionId) continue;
    results.units += group.units;
    results.orders += group.orders;
    results.unknownCostUnits += group.unknownCostUnits;
    costs.set(group.currency, (costs.get(group.currency) ?? 0) + group.costNet);
  }
  results.costs = [...costs].map(([currency, costNet]) => ({ currency, costNet }));
  return results;
}

/** Average cost per unit, per currency; `null` when nothing was given. */
export function averageUnitCost(results: PromotionResults): GiftResultCost[] | null {
  if (results.units === 0) return null;
  return results.costs.map((c) => ({ currency: c.currency, costNet: c.costNet / results.units }));
}
