import { useCallback, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ContentEditor } from '../../features/content/components/content-editor';
import { useProductQuery } from '../../features/products/hooks/use-product-query';
import { ExternalIdsList } from '../../features/products/components/ExternalIdsList';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import type { ProductVariant } from '../../features/products/api/products.types';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';

const VIEW_PARAM = 'view';
const VIEW_OVERVIEW = 'overview';
const VIEW_CONTENT = 'content';

function buildProductItems(product: {
  id: string;
  sku: string | null;
  price: number | null;
  createdAt: string;
  updatedAt: string;
  description?: string | null;
}): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { id: 'productId', label: 'Product ID', value: product.id, mono: true },
    {
      id: 'sku',
      label: 'SKU',
      value: product.sku ?? <span className="text-muted">—</span>,
      mono: Boolean(product.sku),
    },
    {
      id: 'price',
      label: 'Price',
      value:
        product.price !== null ? product.price.toFixed(2) : <span className="text-muted">—</span>,
    },
    { id: 'createdAt', label: 'Created', value: <TimeDisplay iso={product.createdAt} /> },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={product.updatedAt} /> },
  ];
  if (product.description) {
    items.push({ id: 'description', label: 'Description', value: product.description });
  }
  return items;
}

const STOCK_COLUMNS: DataTableColumn<InventoryItem>[] = [
  {
    id: 'productVariantId',
    header: 'Variant ID',
    cell: (item) =>
      item.productVariantId ? (
        <span className="mono-text">{item.productVariantId}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'availableQuantity',
    header: 'Available',
    align: 'right',
    cell: (item) => item.availableQuantity,
  },
  {
    id: 'reservedQuantity',
    header: 'Reserved',
    align: 'right',
    cell: (item) =>
      item.reservedQuantity > 0 ? (
        item.reservedQuantity
      ) : (
        <span className="text-muted">0</span>
      ),
  },
  {
    id: 'locationId',
    header: 'Location',
    cell: (item) =>
      item.locationId ? (
        <span className="mono-text">{item.locationId}</span>
      ) : (
        <span className="text-muted">default</span>
      ),
  },
];

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
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useProductQuery(id);
  const inventoryQuery = useInventoryQuery({ productId: id });

  const activeView = searchParams.get(VIEW_PARAM) === VIEW_CONTENT ? VIEW_CONTENT : VIEW_OVERVIEW;
  const setActiveView = useCallback(
    (value: string): void => {
      const next = new URLSearchParams(searchParams);
      if (value === VIEW_OVERVIEW) {
        next.delete(VIEW_PARAM);
      } else {
        next.set(VIEW_PARAM, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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
      backTo={{ to: '/products', label: 'Products' }}
      eyebrow="Products"
      title={<EntityLabel id={product.id} name={product.name} />}
    >
      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList aria-label="Product views">
          <TabsTrigger value={VIEW_OVERVIEW}>Overview</TabsTrigger>
          <TabsTrigger value={VIEW_CONTENT}>Content</TabsTrigger>
        </TabsList>

        <TabsContent value={VIEW_OVERVIEW}>
          {/* Product metadata */}
          <section className="detail-section">
            <KeyValueList items={buildProductItems(product)} />
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

          {/* Stock */}
          <section className="detail-section">
            <h3 className="detail-section__title">Stock</h3>
            {inventoryQuery.isLoading ? (
              <LoadingState
                liveRegion="off"
                title="Loading stock"
                message="Fetching inventory data…"
              />
            ) : inventoryQuery.error ? (
              <ErrorState
                title="Unable to load stock"
                message={inventoryQuery.error.message}
                action={
                  <Button onClick={() => { void inventoryQuery.refetch(); }}>Retry</Button>
                }
              />
            ) : (inventoryQuery.data?.items.length ?? 0) === 0 ? (
              // No action: stock is sourced from the product master and not editable here.
              <EmptyState
                liveRegion="off"
                title="No stock records"
                message="No inventory records found for this product."
              />
            ) : (
              <DataTable
                caption="Stock levels"
                columns={STOCK_COLUMNS}
                rows={inventoryQuery.data?.items ?? []}
                rowKey={(item) => item.id}
              />
            )}
          </section>
        </TabsContent>

        <TabsContent value={VIEW_CONTENT}>
          <ContentEditor productId={product.id} />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
