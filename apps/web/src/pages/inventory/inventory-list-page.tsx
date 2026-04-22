import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import type { InventoryItem, InventoryFilters } from '../../features/inventory/api/inventory.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function resolveInventoryLabel(item: InventoryItem): string {
  return item.productName ?? item.productSku ?? item.productId;
}

function renderInventoryNameNode(item: InventoryItem): ReactNode {
  if (item.productName) {
    return <span className="product-row__name">{item.productName}</span>;
  }
  if (item.productSku) {
    return (
      <span className="product-row__name mono-text" title={item.productSku}>
        {item.productSku}
      </span>
    );
  }
  return (
    <span className="product-row__name mono-text text-muted" title={item.productId}>
      {item.productId}
    </span>
  );
}

const COLUMNS: DataTableColumn<InventoryItem>[] = [
  {
    id: 'product',
    header: 'Product',
    cell: (item): ReactNode => {
      const showSkuSublabel = Boolean(item.productName) && Boolean(item.productSku);
      return (
        <span className="product-row">
          <ProductThumbnail
            src={item.productImageUrl}
            name={resolveInventoryLabel(item)}
            size="sm"
          />
          {renderInventoryNameNode(item)}
          {showSkuSublabel ? (
            <span className="text-muted">
              <span className="mono-text" title={item.productSku ?? undefined}>
                {item.productSku}
              </span>
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    id: 'productVariantId',
    header: 'Variant ID',
    cell: (item) =>
      item.productVariantId ? (
        <span className="mono-text" title={item.productVariantId}>{item.productVariantId}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
    hideBelow: 1024,
  },
  {
    id: 'availableQuantity',
    header: 'Available',
    align: 'right',
    cell: (item) => item.availableQuantity,
    accessor: (item) => item.availableQuantity,
    sortable: true,
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
    accessor: (item) => item.reservedQuantity,
    sortable: true,
    hideBelow: 768,
  },
  {
    id: 'locationId',
    header: 'Location',
    cell: (item) =>
      item.locationId ? (
        <span className="mono-text" title={item.locationId}>{item.locationId}</span>
      ) : (
        <span className="text-muted">default</span>
      ),
    hideBelow: 768,
  },
  {
    id: 'updatedAt',
    header: 'Updated',
    cell: (item) => <TimeDisplay iso={item.updatedAt} format="date" />,
    accessor: (item) => item.updatedAt,
    sortable: true,
    hideBelow: 1024,
  },
];

export function InventoryListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'updatedAt', desc: true }]);

  const urlProductId = searchParams.get('productId') ?? '';
  const urlVariantId = searchParams.get('productVariantId') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [productIdInput, setProductIdInput] = useState(urlProductId);
  const [variantIdInput, setVariantIdInput] = useState(urlVariantId);
  const debouncedProductId = useDebouncedValue(productIdInput, SEARCH_DEBOUNCE_MS);
  const debouncedVariantId = useDebouncedValue(variantIdInput, SEARCH_DEBOUNCE_MS);

  const filters: InventoryFilters = {
    productId: debouncedProductId || undefined,
    productVariantId: debouncedVariantId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useInventoryQuery(filters, pagination);

  function handleFilterChange(key: string, value: string): void {
    if (key === 'productId') setProductIdInput(value);
    if (key === 'productVariantId') setVariantIdInput(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  function clearFilters(): void {
    setProductIdInput('');
    setVariantIdInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('productId');
      next.delete('productVariantId');
      next.delete('offset');
      return next;
    });
  }

  const filtersActive = Boolean(debouncedProductId || debouncedVariantId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Inventory"
      description="Stock visibility — browse available and reserved quantities."
    >
      {/* Filters */}
      <div className="toolbar toolbar--compact">
        <input
          aria-label="Filter by product ID"
          placeholder="Product ID…"
          value={productIdInput}
          onChange={(e) => { handleFilterChange('productId', e.target.value); }}
        />
        <input
          aria-label="Filter by variant ID"
          placeholder="Variant ID…"
          value={variantIdInput}
          onChange={(e) => { handleFilterChange('productVariantId', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={COLUMNS} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load inventory"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No inventory items found"
          message={
            filtersActive
              ? 'No inventory items match the current filters.'
              : 'No inventory records have been synced yet.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Link className="button button--primary" to="/products">
                Browse products
              </Link>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption="Inventory items"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(item) => item.id}
            rowHref={(item) => item.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (item) => {
                const label = resolveInventoryLabel(item);
                return (
                  <span className="product-row">
                    <ProductThumbnail src={item.productImageUrl} name={label} size="sm" />
                    <span className="product-row__name">{label}</span>
                  </span>
                );
              },
              subtitle: (item) => item.productVariantId ?? '',
              meta: (item) => `${item.availableQuantity} avail`,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
