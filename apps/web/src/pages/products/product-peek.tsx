/**
 * ProductPeek (#4027)
 *
 * What a products row opens (row click, the arrow column or a card): the shared
 * `PeekPanel` with the product name linking to its page, the SKU, origin and
 * variant count, then Open product / Edit content / + Publish, a Stock /
 * Listings / Tax rate state card and the content of the former expanded row
 * (variants and stock, live marketplace status, IDs). ↑ ↓ / j k walk the rows.
 *
 * The page builds the cells (the same renderers the table uses), so the peek
 * and the row can never disagree about a product.
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { renderRich, useMessages } from '../../shared/i18n';
import { PeekPanel, PeekStateCard } from '../../shared/ui/peek-panel';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { StatusBadge } from '../../shared/ui/status-badge';
import type { Product } from '../../features/products/api/products.types';

export interface ProductPeekView {
  product: Product;
  /** The origin connection chip, or null when the product has none. */
  source: ReactNode;
  /** "3 variants"; null for a simple product. */
  variants: string | null;
  price: ReactNode;
  stockBadge: ReactNode;
  stock: ReactNode;
  listings: ReactNode;
  /** Tax rate state and the deleted-at-source flag; null when unknown. */
  taxRate: ReactNode;
  /** Present only when the operator may publish and a gap exists. */
  onPublish?: () => void;
  detail: ReactNode;
}

export interface ProductPeekProps {
  view: ProductPeekView | null;
  position: number;
  count: number;
  onNavigate: (step: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
}

export function ProductPeek({ view, position, count, onNavigate, onOpenChange }: ProductPeekProps): ReactElement {
  const page = useMessages('products').productsListPage;
  const copy = page.peek;
  const product = view?.product;
  return (
    <PeekPanel
      open={view !== null}
      onOpenChange={onOpenChange}
      position={position}
      count={count}
      onNavigate={onNavigate}
      bodyKey={product?.id}
      description={copy.description}
      title={
        product ? (
          <span className="peek-panel__ref product-peek__id">
            <ProductThumbnail src={product.images?.[0]} name={product.name} size="sm" />
            <Link className="peek-panel__title-link" to={`/products/${product.id}`}>
              {product.name}
              <span className="peek-panel__title-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </span>
        ) : (
          copy.kicker
        )
      }
      meta={
        view && product ? (
          <span className="peek-panel__meta">
            {product.sku ? (
              <span>
                {renderRich(
                  page.row.sku,
                  { value: (text: string) => <span className="mono-text">{text}</span> },
                  { sku: product.sku },
                )}
              </span>
            ) : null}
            {view.source}
            {view.variants ? <span>{view.variants}</span> : null}
          </span>
        ) : null
      }
      headerAside={
        view ? (
          <>
            <span className="peek-panel__total tabular">{view.price}</span>
            {view.stockBadge}
          </>
        ) : null
      }
    >
      {view && product ? (
        <>
          <div className="peek-panel__actions">
            <Link className="button button--primary button--sm" to={`/products/${product.id}`}>
              {copy.openProduct}
            </Link>
            <Link className="button button--secondary button--sm" to={`/products/${product.id}?view=content`}>
              {copy.editContent}
            </Link>
            {view.onPublish ? (
              <button type="button" className="button button--secondary button--sm" onClick={view.onPublish}>
                {page.row.publish}
              </button>
            ) : null}
          </div>
          <PeekStateCard
            label={copy.stateAria}
            rows={[
              { label: copy.stock, value: view.stock },
              { label: copy.listings, value: view.listings },
              ...(view.taxRate ? [{ label: copy.taxRate, value: view.taxRate }] : []),
            ]}
          />
          {view.detail}
        </>
      ) : null}
    </PeekPanel>
  );
}

/** The tax-rate badge for a product, from the fields the list carries. */
export function ProductTaxRateBadge({ product }: { product: Product }): ReactElement | null {
  const copy = useMessages('products').productsListPage;
  if (product.taxRate) {
    return (
      <StatusBadge tone="success" withDot compact>
        {copy.peek.taxSet}
      </StatusBadge>
    );
  }
  if (product.taxRateReadAt === undefined) return null;
  return product.taxRateReadAt === null ? (
    <StatusBadge tone="neutral" withDot compact>
      {copy.listFilters.tax.notChecked}
    </StatusBadge>
  ) : (
    <StatusBadge tone="error" withDot compact>
      {copy.listFilters.tax.missing}
    </StatusBadge>
  );
}
