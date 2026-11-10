/**
 * Bundle return split and refund hint (#3933)
 *
 * When ONE component of a bundle comes back, the set price has to be divided so
 * the operator can see what that component is worth. The split is computed at
 * RETURN time from standalone prices (the cost when a component is not sold
 * alone), never read from a frozen order-time figure: the returned component is
 * valued by what it is today, and the sum is forced back to the paid amount so
 * the parts always add up to what the buyer actually paid.
 *
 * Pure: no I/O, no clock, no injected dependency. Amounts are in minor units
 * internally so the remainder rule is exact.
 *
 * @module domain/domain-services
 */

export interface SplitComponent {
  variantId: string;
  /** Units of this component per ONE bundle unit. */
  quantity: number;
  /** Standalone gross price of one unit, when the component is sold alone. */
  unitPrice?: number | null;
  /** Net cost of one unit, used only when there is no standalone price. */
  unitCost?: number | null;
}

export const BundleSplitRefusalReasonValues = ['no-price-no-cost', 'no-components', 'bad-total'] as const;
export type BundleSplitRefusalReason = (typeof BundleSplitRefusalReasonValues)[number];

export interface BundleSplitShare {
  variantId: string;
  /** Gross share of ONE bundle unit's price carried by this component (all its units). */
  shareGross: number;
  /** Which figure weighted it. */
  basis: 'price' | 'cost';
}

export type BundleSplitResult =
  | { status: 'split'; shares: BundleSplitShare[] }
  | { status: 'refused'; reason: BundleSplitRefusalReason; variantIds: string[] };

function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

function isUsable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Split the gross price paid for ONE bundle unit across its components.
 *
 * Weight is the component's standalone price times its quantity, or its cost
 * times its quantity when it has no standalone price. A component with neither
 * makes the whole split refuse - guessing a weight for it would move the other
 * components' shares on no evidence. The remainder goes to the component with the
 * largest weight (the first on a tie, in input order) so the shares sum exactly.
 */
export function splitBundleAmount(
  paidPerBundleUnit: number,
  components: readonly SplitComponent[]
): BundleSplitResult {
  if (components.length === 0) {
    return { status: 'refused', reason: 'no-components', variantIds: [] };
  }
  if (!Number.isFinite(paidPerBundleUnit) || paidPerBundleUnit < 0) {
    return { status: 'refused', reason: 'bad-total', variantIds: [] };
  }

  const weighted = components.map((component) => {
    if (isUsable(component.unitPrice)) {
      return { component, weight: toMinor(component.unitPrice) * component.quantity, basis: 'price' as const };
    }
    if (isUsable(component.unitCost)) {
      return { component, weight: toMinor(component.unitCost) * component.quantity, basis: 'cost' as const };
    }
    return { component, weight: null, basis: 'price' as const };
  });

  const missing = weighted.filter((entry) => entry.weight === null);
  if (missing.length > 0) {
    return {
      status: 'refused',
      reason: 'no-price-no-cost',
      variantIds: missing.map((entry) => entry.component.variantId),
    };
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
  const totalMinor = toMinor(paidPerBundleUnit);
  const minors = weighted.map((entry) => Math.floor((totalMinor * (entry.weight ?? 0)) / totalWeight));
  const remainder = totalMinor - minors.reduce((sum, value) => sum + value, 0);

  let largest = 0;
  weighted.forEach((entry, index) => {
    if ((entry.weight ?? 0) > (weighted[largest].weight ?? 0)) {
      largest = index;
    }
  });
  minors[largest] += remainder;

  return {
    status: 'split',
    shares: weighted.map((entry, index) => ({
      variantId: entry.component.variantId,
      shareGross: minors[index] / 100,
      basis: entry.basis,
    })),
  };
}

/**
 * The Allegro moderator formula, as a HINT: what was paid for the set, minus the
 * full standalone price of what the buyer keeps, never below zero.
 *
 * It is a suggestion the operator may use or ignore, never a default and never
 * applied by core - OpenLinker records a refund, it does not execute one.
 * `keptStandaloneGross` is the sum of the kept components' full standalone gross
 * prices (not their split shares): that is what the formula subtracts.
 */
export function keptAtStandaloneRefundHint(paidForSetGross: number, keptStandaloneGross: number): number {
  if (!Number.isFinite(paidForSetGross) || !Number.isFinite(keptStandaloneGross)) {
    return 0;
  }
  return Math.max(0, Math.round((paidForSetGross - keptStandaloneGross) * 100) / 100);
}
