/**
 * Bulk multipack page: `/products/bundles/bulk?products=<id>,<id>`.
 * Reads the selection from the products list; creates nothing on load.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BundleBulkCreator } from '../../features/bundles';
import { useMessages } from '../../shared/i18n';

export function BundleBulkPage(): ReactElement {
  const copy = useMessages('bundles');
  const [searchParams] = useSearchParams();
  const ids = [
    ...new Set(
      (searchParams.get('products') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ];
  return (
    <section className="page-section">
      {ids.length === 0 ? (
        <p>
          {copy.bulk.noSelection} <Link to="/products">{copy.bulk.backToProducts}</Link>
        </p>
      ) : (
        <BundleBulkCreator key={ids.join(',')} productIds={ids} />
      )}
    </section>
  );
}
