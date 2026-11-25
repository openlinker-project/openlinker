/**
 * Bundle kind
 *
 * A bundle definition with ONE component sold in a quantity above one is a
 * multipack (the same product, N pieces); anything else is a set (different
 * products). Allegro publishes the first as a single `productSet` entry with
 * `quantity = N` and the second as one entry per product, so the wizard names
 * them differently instead of calling every bundle a "set".
 *
 * @module apps/web/src/features/listings/components/bulk
 */

export type BundleKind = 'set' | 'pack';

interface KindInput {
  components: ReadonlyArray<{ quantity: number; giftSlot?: boolean }>;
}

/** The pack size when the bundle is a multipack, else null. */
export function packSizeOf(bundle: KindInput): number | null {
  const paid = bundle.components.filter((component) => component.giftSlot !== true);
  return paid.length === 1 && bundle.components.length === 1 && paid[0].quantity > 1
    ? paid[0].quantity
    : null;
}

export function bundleKindOf(bundle: KindInput): BundleKind {
  return packSizeOf(bundle) === null ? 'set' : 'pack';
}

interface UnsettledRow {
  variants: ReadonlyArray<{ variantId: string; included: boolean }>;
}

export interface UnsettledBundles {
  /** Included variants the composition check has not answered for yet. */
  pending: ReadonlySet<string>;
  /** Included variants whose check finished without an answer. */
  failed: ReadonlySet<string>;
}

/**
 * Rows whose bundle status is not known yet. Until the composition check
 * answers, a bundle would be judged as an ordinary product - with the wrong
 * blockers - so the review step shows a neutral state instead. Every included
 * variant is held while the check runs: the product list only knows which rows
 * are bundles for the ones it marked, and the batch read does not carry that mark.
 */
export function unsettledBundleVariants(
  rows: readonly UnsettledRow[],
  answered: ReadonlySet<string>,
  failed: ReadonlySet<string>,
  isLoading: boolean,
): UnsettledBundles {
  const pending = new Set<string>();
  const failedOut = new Set<string>();
  for (const row of rows) {
    for (const variant of row.variants) {
      if (!variant.included || answered.has(variant.variantId)) continue;
      if (isLoading) pending.add(variant.variantId);
      else if (failed.has(variant.variantId)) failedOut.add(variant.variantId);
    }
  }
  return { pending, failed: failedOut };
}

/**
 * Allegro's "Stan" (condition) parameter id. The adapter sends "new" when it is
 * empty (see allegro-offer-validation.ts), so on a set it never blocks - yet the
 * schema marks it required and its name is the same word as the stock field.
 */
const CONDITION_PARAMETER_ID = '11323';

/** Condition parameter shown as optional under its own name; others pass through. */
export function relabelConditionParameter<T extends { id: string; name: string; required?: boolean }>(
  parameter: T,
  label: string,
): T {
  return parameter.id === CONDITION_PARAMETER_ID
    ? { ...parameter, name: label, required: false }
    : parameter;
}
