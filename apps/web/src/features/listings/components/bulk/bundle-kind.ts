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
