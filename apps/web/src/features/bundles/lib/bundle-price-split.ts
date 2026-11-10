/**
 * Bundle price split (#3624)
 *
 * What each component of a bundle contributes to the bundle's price, shown on
 * demand in the form. Pure and display-only: the order line, the document and
 * the channel keep the bundle's one price, so nothing stored depends on it.
 *
 * Rule: the bundle price is shared in proportion to each component's standalone
 * price times its quantity, in whole minor units (grosze), and the rounding
 * remainder goes to the largest share so the parts always add up to the price.
 * A gift component takes no share (the customer pays nothing for it). A
 * component with no known price makes the split unavailable rather than
 * guessing: a split with an invented number in it is worse than none.
 *
 * @module apps/web/src/features/bundles/lib
 */

export interface PriceSplitComponent {
  variantId: string;
  quantity: number;
  /** Gross catalogue price of ONE unit, or `null` when unknown. */
  standalonePrice: number | null;
  giftSlot?: boolean;
}

export interface PriceSplitLine {
  variantId: string;
  /** What the component contributes for the whole bundle unit (quantity included). */
  amount: number;
}

export type PriceSplit =
  | { kind: 'ok'; lines: PriceSplitLine[] }
  | { kind: 'no-price' }
  | { kind: 'no-paid-component' }
  | { kind: 'unknown-component-price'; variantIds: string[] };

const toMinor = (amount: number): number => Math.round(amount * 100);
const fromMinor = (minor: number): number => minor / 100;

export function splitBundlePrice(
  bundlePrice: number | null,
  components: readonly PriceSplitComponent[],
): PriceSplit {
  if (bundlePrice === null || !Number.isFinite(bundlePrice) || bundlePrice < 0) {
    return { kind: 'no-price' };
  }
  const paid = components.filter((component) => component.giftSlot !== true);
  if (paid.length === 0) {
    return { kind: 'no-paid-component' };
  }
  const unknown = paid.filter((c) => c.standalonePrice === null).map((c) => c.variantId);
  if (unknown.length > 0) {
    return { kind: 'unknown-component-price', variantIds: unknown };
  }

  const weights = paid.map((c) => toMinor(c.standalonePrice ?? 0) * c.quantity);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const totalMinor = toMinor(bundlePrice);
  // All standalone prices zero: share equally rather than divide by nothing.
  const effective = totalWeight > 0 ? weights : paid.map(() => 1);
  const effectiveTotal = totalWeight > 0 ? totalWeight : paid.length;

  const shares = effective.map((weight) => Math.floor((totalMinor * weight) / effectiveTotal));
  const remainder = totalMinor - shares.reduce((sum, share) => sum + share, 0);
  if (remainder !== 0) {
    const largest = effective.reduce(
      (best, weight, index) => (weight > (effective[best] ?? -1) ? index : best),
      0,
    );
    shares[largest] = (shares[largest] ?? 0) + remainder;
  }

  const amountByVariant = new Map(paid.map((c, index) => [c.variantId, fromMinor(shares[index] ?? 0)]));
  return {
    kind: 'ok',
    lines: components.map((component) => ({
      variantId: component.variantId,
      amount: amountByVariant.get(component.variantId) ?? 0,
    })),
  };
}
