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
import { BundleForm } from '../../features/bundles';

export function BundleFormPage(): ReactElement {
  const { variantId } = useParams<{ variantId: string }>();
  const [searchParams] = useSearchParams();
  const component = searchParams.get('component');
  const componentProduct = searchParams.get('componentProduct');
  // "<productId>:<qty>,..." from the product list selection; malformed
  // entries are skipped so a hand-edited URL degrades to fewer rows.
  const seedComponents = (searchParams.get('components') ?? '')
    .split(',')
    .map((entry) => {
      const [productId, rawQty] = entry.split(':');
      const qty = Number(rawQty ?? '1');
      return productId
        ? { productId, quantity: Number.isInteger(qty) && qty > 0 ? qty : 1 }
        : null;
    })
    .filter((entry): entry is { productId: string; quantity: number } => entry !== null);
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
