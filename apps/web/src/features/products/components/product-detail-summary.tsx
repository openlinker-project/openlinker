/**
 * Product Detail Summary
 *
 * Shared quick-identity block for a product — a links strip (open the full
 * product page, jump to content editing) plus a compact fields grid
 * (internal ID, source external ID, currency, stock sync time). Extracted
 * from `pages/products/product-row-detail.tsx` (#1720) so the Analytics Top
 * Products inline-expand panel (#2765) reuses the exact same markup/CSS
 * instead of re-implementing it — one source of truth for "what does OL know
 * about this product, in brief".
 *
 * `productId` is taken as its own argument (not read off `product.id`) so a
 * caller that only has the internal id in hand — Analytics' `TopProductRow`
 * resolves a `Product` via a best-effort batch query that can still be
 * loading or unresolved — can render the links immediately; `product` is
 * optional and every field degrades to its existing placeholder when absent
 * or partially populated.
 *
 * @module apps/web/src/features/products/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { Product } from '../api/products.types';

export interface ProductDetailLinksProps {
  productId: string;
}

export function ProductDetailLinks({ productId }: ProductDetailLinksProps): ReactElement {
  return (
    <div className="products-detail-links">
      <Link
        className="products-detail-links__link products-detail-links__link--internal"
        to={`/products/${productId}`}
        title="Open the full product detail page"
      >
        Product details <span className="products-detail-links__arrow">&rarr;</span>
      </Link>
      <Link
        className="products-detail-links__link products-detail-links__link--internal"
        to={`/products/${productId}?view=content`}
        title="Edit this product's description"
      >
        Edit content <span className="products-detail-links__arrow">&rarr;</span>
      </Link>
    </div>
  );
}

export interface ProductDetailFieldsProps {
  productId: string;
  product?: Product;
}

export function ProductDetailFields({ productId, product }: ProductDetailFieldsProps): ReactElement {
  const source = product?.externalIds?.[0];

  return (
    <div className="products-detail-fields">
      <div className="products-detail-field">
        <div className="products-detail-field__label">Internal ID</div>
        <div className="products-detail-field__value mono-text">{productId}</div>
      </div>
      <div className="products-detail-field">
        <div className="products-detail-field__label">Source external ID</div>
        <div className="products-detail-field__value mono-text">
          {source ? (
            `${source.platformType} · ${source.externalId}`
          ) : (
            <span className="text-muted">-</span>
          )}
        </div>
      </div>
      <div className="products-detail-field">
        <div className="products-detail-field__label">Currency</div>
        <div className="products-detail-field__value">
          {product?.currency ?? <span className="text-muted">not set by source</span>}
        </div>
      </div>
      <div className="products-detail-field">
        <div className="products-detail-field__label">Stock synced</div>
        <div className="products-detail-field__value">
          {product?.stockUpdatedAt ? (
            <TimeDisplay iso={product.stockUpdatedAt} format="datetime" />
          ) : (
            <span className="text-muted">-</span>
          )}
        </div>
      </div>
    </div>
  );
}
