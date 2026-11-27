/**
 * Promotion one-line texts (#3935)
 *
 * The condition and the combining chip of a promotion row, as plain words: "Cart
 * from 200.00 zl", "Contains Earl Grey tea", "Only with selected (2)". Pure; the
 * copy and the product names come in as arguments.
 *
 * @module apps/web/src/features/promotions/lib
 */
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate } from '../../../shared/i18n';
import type { Promotion } from '../api/promotions.types';

export interface PromotionRowCopy {
  basket: string;
  contains: string;
  perUnit: string;
  onlySelected: string;
  noCombine: string;
}

/** The condition line under a promotion's name. */
export function conditionText(
  promotion: Promotion,
  copy: PromotionRowCopy,
  nameOf: (variantId: string) => string,
): string {
  if (promotion.benefit.perUnit !== null) {
    const contains = promotion.conditions.find((c) => c.field === 'containsProduct');
    return interpolate(copy.perUnit, {
      n: String(promotion.benefit.perUnit.per),
      product: contains && contains.field === 'containsProduct' ? nameOf(contains.value) : '',
    });
  }
  const amount = promotion.conditions.find((c) => c.field === 'orderTotalGross');
  if (amount && amount.field === 'orderTotalGross') {
    return interpolate(copy.basket, {
      amount: formatAmount(Number(amount.amount), amount.currency),
    });
  }
  const contains = promotion.conditions.find((c) => c.field === 'containsProduct');
  if (contains && contains.field === 'containsProduct') {
    return interpolate(copy.contains, { product: nameOf(contains.value) });
  }
  return '';
}

/** The chip beside a name when the promotion does not stack with everything; `null` when it does. */
export function combineChip(promotion: Pick<Promotion, 'combinesWith'>, copy: PromotionRowCopy): string | null {
  const { combinesWith } = promotion;
  if (combinesWith.mode === 'none') return copy.noCombine;
  if (combinesWith.mode === 'selected') {
    return interpolate(copy.onlySelected, { n: String(combinesWith.promotionIds.length) });
  }
  return null;
}
