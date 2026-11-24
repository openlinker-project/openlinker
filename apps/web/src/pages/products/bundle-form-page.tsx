/**
 * Bundle form page (#3624)
 *
 * `/products/bundles/new` (optionally `?component=<variantId>&quantity=<n>`
 * to start from a product, as the multipack hold does) and
 * `/products/bundles/:variantId` to change one.
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
  const quantity = Number(searchParams.get('quantity') ?? '1');

  return (
    <section className="page-section">
      <BundleForm
        key={variantId ?? component ?? componentProduct ?? 'new'}
        bundleVariantId={variantId}
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
