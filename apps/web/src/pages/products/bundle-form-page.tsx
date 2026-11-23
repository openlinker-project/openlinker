/**
 * Bundle form page (#3624)
 *
 * `/products/bundles/new` (optionally `?component=<variantId>&quantity=<n>`
 * to start from a product, as the multipack hold does) and
 * `/products/bundles/:variantId` to change one, and `?from=<bundleVariantId>` to start a new
 * one with the components of an existing bundle.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  BundleForm,
  MAX_COMPONENT_QUANTITY,
  clampSeedQuantity,
  type BundleSeedAdjustment,
} from '../../features/bundles';

export function BundleFormPage(): ReactElement {
  const { variantId } = useParams<{ variantId: string }>();
  const [searchParams] = useSearchParams();
  const component = searchParams.get('component');
  const componentProduct = searchParams.get('componentProduct');
  // "<productId>:<qty>,..." from the product list selection; malformed entries are skipped so a
  // hand-edited URL degrades to fewer rows. The same product twice becomes one row with the
  // quantities added, and a quantity outside 1..9999 is brought into range - both are reported to
  // the form so it can say so instead of changing what was pasted in silence.
  const seedAdjustments: BundleSeedAdjustment[] = [];
  const merged = new Map<string, number>();
  const mergedTwice = new Set<string>();
  const alteredRaw = new Map<string, boolean>();
  for (const entry of (searchParams.get('components') ?? '').split(',')) {
    const [productId, rawQty] = entry.split(':');
    if (!productId) continue;
    const { quantity, altered } = clampSeedQuantity(rawQty);
    if (altered) alteredRaw.set(productId, true);
    if (merged.has(productId)) mergedTwice.add(productId);
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  const seedComponents = [...merged.entries()].map(([productId, total]) => {
    const quantity = Math.min(MAX_COMPONENT_QUANTITY, total);
    if (mergedTwice.has(productId)) seedAdjustments.push({ kind: 'merged', id: productId, to: quantity });
    else if (alteredRaw.has(productId)) seedAdjustments.push({ kind: 'clamped', id: productId, to: quantity });
    return { productId, quantity };
  });
  const duplicateFrom = searchParams.get('from');
  const quantity = Number(searchParams.get('quantity') ?? '1');

  return (
    <section className="page-section">
      <BundleForm
        key={variantId ?? duplicateFrom ?? component ?? componentProduct ?? (seedComponents.length > 0 ? 'multi' : 'new')}
        duplicateFrom={variantId === undefined && duplicateFrom !== null ? duplicateFrom : undefined}
        bundleVariantId={variantId}
        seedComponents={
          variantId === undefined && seedComponents.length > 0 ? seedComponents : undefined
        }
        seedAdjustments={variantId === undefined ? seedAdjustments : undefined}
        seedComponent={
          (component !== null || componentProduct !== null) && variantId === undefined
            ? {
                ...(component !== null ? { variantId: component } : {}),
                ...(componentProduct !== null ? { productId: componentProduct } : {}),
                quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
              }
            : undefined
        }
      />
    </section>
  );
}
