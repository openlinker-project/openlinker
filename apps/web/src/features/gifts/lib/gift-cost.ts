/**
 * What a gift costs the seller, read honestly (#3940)
 *
 * The purchase cost comes from a separate read, so "no cost" has four different
 * meanings that must never share one sentence: the read is still pending, it
 * failed, the product has no cost on file, or the cost is recorded in a currency
 * other than the one the order is in. Only the third may say "not recorded"; a
 * cost in another currency is never printed as if it were in the order currency.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { VariantCost } from '../../products';

export type GiftCostView =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'none' }
  | { kind: 'other-currency'; currency: string }
  | { kind: 'known'; unitCost: number };

export interface GiftCostReadInput {
  status: 'pending' | 'error' | 'success';
  costs: readonly VariantCost[] | undefined;
  variantId: string | undefined;
  /** The currency of the order or basket the cost is shown beside. */
  currency: string | undefined;
}

export function readGiftCost({ status, costs, variantId, currency }: GiftCostReadInput): GiftCostView {
  if (status === 'pending') return { kind: 'loading' };
  if (status === 'error') return { kind: 'failed' };
  const row = costs?.find((c) => c.variantId === variantId);
  if (row === undefined || row.netUnitCost === null || row.netUnitCost === '') return { kind: 'none' };
  const costCurrency = row.costCurrency;
  if (
    costCurrency !== null &&
    currency !== undefined &&
    costCurrency.toUpperCase() !== currency.toUpperCase()
  ) {
    return { kind: 'other-currency', currency: costCurrency };
  }
  const unitCost = Number(row.netUnitCost);
  return Number.isFinite(unitCost) ? { kind: 'known', unitCost } : { kind: 'none' };
}

export interface GiftCostCopy {
  loading: string;
  failed: string;
  otherCurrency: string;
}

/** The sentence for a cost view; `known` and `none` differ per surface (per unit, or for all units). */
export function giftCostText(
  view: GiftCostView,
  copy: GiftCostCopy,
  surface: { known: (unitCost: number) => string; none: string },
  interpolateCurrency: (template: string, currency: string) => string,
): string {
  switch (view.kind) {
    case 'loading':
      return copy.loading;
    case 'failed':
      return copy.failed;
    case 'other-currency':
      return interpolateCurrency(copy.otherCurrency, view.currency);
    case 'none':
      return surface.none;
    case 'known':
      return surface.known(view.unitCost);
  }
}
