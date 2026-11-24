/**
 * Free Gift Policy (#3935)
 *
 * The `free-gift` benefit's own rules: the per-unit quantity, skip-if-present
 * (including the components of a bundle line) and the stock check. An unknown
 * stock number is never read as zero or as plenty; it adds nothing.
 *
 * @module libs/core/src/promotions/domain/domain-services/benefit-policies
 */
import type { FreeGiftBenefit } from '../../types/promotion-benefit.types';
import type { PromotionPlanLine } from '../../types/promotion-facts.types';
import type { BenefitPolicy, BenefitPolicyInput, BenefitQuantityResult, BenefitSupplyResult } from './benefit-policy';

function wantedQuantity(
  benefit: FreeGiftBenefit,
  lines: readonly PromotionPlanLine[],
): number | 'below-threshold' {
  if (benefit.perUnit === null) return benefit.quantity;
  const { productId, per, maxPerOrder } = benefit.perUnit;
  const units = lines
    .filter((line) => !line.isGift && line.productId === productId)
    .reduce((sum, line) => sum + line.quantity, 0);
  const batches = Math.floor(units / per);
  if (batches < 1) return 'below-threshold';
  return benefit.quantity * (maxPerOrder === null ? batches : Math.min(batches, maxPerOrder));
}

export const freeGiftPolicy: BenefitPolicy<'free-gift'> = {
  kind: 'free-gift',

  quantity({ benefit, lines, componentProductIds }: BenefitPolicyInput<'free-gift'>): BenefitQuantityResult {
    const wanted = wantedQuantity(benefit, lines);
    if (wanted === 'below-threshold') return { skip: 'below-per-unit-threshold' };
    if (benefit.skipIfPresent) {
      const present =
        lines.some(
          (line) =>
            !line.isGift &&
            (line.productId === benefit.productId || line.variantId === benefit.variantId),
        ) || (componentProductIds?.has(benefit.productId) ?? false);
      if (present) return { skip: 'gift-already-in-order' };
    }
    return { quantity: wanted };
  },

  supply({ context }: BenefitPolicyInput<'free-gift'>, quantity: number): BenefitSupplyResult {
    if (context.stock.kind === 'unknown') return { skip: 'gift-stock-unknown', stateChange: null };
    if (context.stock.available < quantity) {
      return {
        skip: 'gift-out-of-stock',
        stateChange: { kind: 'pause', reason: 'gift-out-of-stock' },
      };
    }
    return null;
  },
};
