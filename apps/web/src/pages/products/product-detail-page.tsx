import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
import { ExternalIdsList } from '../../features/products/components/ExternalIdsList';
import type { ProductVariant } from '../../features/products/api/products.types';

const VARIANT_COLUMNS: DataTableColumn<ProductVariant>[] = [
  {
    id: 'sku',
    header: 'SKU',
    cell: (v) =>
      v.sku ? (
        <span className="mono-text">{v.sku}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'ean',
    header: 'EAN',
    cell: (v) =>
      v.ean ? (
        <span className="mono-text">{v.ean}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'gtin',
    header: 'GTIN',
    cell: (v) =>
      v.gtin ? (
        <span className="mono-text">{v.gtin}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'attributes',
    header: 'Attributes',
    cell: (v) => {
      if (!v.attributes || Object.keys(v.attributes).length === 0) {
        return <span className="text-muted">—</span>;
      }
      return (
        <span className="mono-text">
          {Object.entries(v.attributes)
            .map(([key, val]) => `${key}: ${String(val)}`)
            .join(', ')}
        </span>
      );
    },
  },
  {
    id: 'externalIds',
    header: 'External IDs',
    cell: (v) => {
      if (!v.externalIds || v.externalIds.length === 0) {
        return <span className="text-muted">—</span>;
      }
      return (
        <span className="mono-text">
          {v.externalIds.map((e) => `${e.platformType}:${e.externalId}`).join(', ')}
        </span>
      );
    },
  },
];

export function ProductDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useProductQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Products" title="Product detail">
        <LoadingState liveRegion="off" title="Loading product" message="Fetching product details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Products" title="Product detail">
        <ErrorState
          title="Unable to load product"
          message={query.error?.message ?? 'Product not found'}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      </PageLayout>
    );
  }

  const product = query.data;

  return (
    <PageLayout
      eyebrow="Products"
      title={product.name}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to products
        </Link>
      }
    >
      {/* Product metadata */}
      <section className="detail-section">
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Product ID</dt>
            <dd><span className="mono-text">{product.id}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>SKU</dt>
            <dd>
              {product.sku ? (
                <span className="mono-text">{product.sku}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Price</dt>
            <dd>{product.price !== null ? product.price.toFixed(2) : <span className="text-muted">—</span>}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Created</dt>
            <dd>{new Date(product.createdAt).toLocaleString()}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd>{new Date(product.updatedAt).toLocaleString()}</dd>
          </div>
          {product.description ? (
            <div className="detail-list__row">
              <dt>Description</dt>
              <dd>{product.description}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* External IDs */}
      <section className="detail-section">
        <h3 className="detail-section__title">External IDs</h3>
        <ExternalIdsList mappings={product.externalIds ?? []} />
      </section>

      {/* Variants */}
      <section className="detail-section">
        <h3 className="detail-section__title">
          Variants{product.variants ? ` (${product.variants.length})` : ''}
        </h3>
        {product.variants && product.variants.length > 0 ? (
          <DataTable
            caption="Product variants"
            columns={VARIANT_COLUMNS}
            rows={product.variants}
            rowKey={(v) => v.id}
          />
        ) : (
          <p className="text-muted">No variants found for this product.</p>
        )}
      </section>
    </PageLayout>
  );
}
