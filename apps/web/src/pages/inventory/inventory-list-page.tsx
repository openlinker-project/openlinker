import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useInventoryQuery } from '../../features/inventory/hooks/use-inventory-query';
import type { InventoryItem, InventoryFilters } from '../../features/inventory/api/inventory.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<InventoryItem>[] = [
  {
    id: 'product',
    header: 'Product',
    cell: (item) => {
      if (item.productName) {
        return (
          <span>
            {item.productName}
            {item.productSku ? (
              <span className="text-muted sku-label">
                <span className="mono-text">{item.productSku}</span>
              </span>
            ) : null}
          </span>
        );
      }
      if (item.productSku) {
        return <span className="mono-text">{item.productSku}</span>;
      }
      return <span className="mono-text text-muted">{item.productId}</span>;
    },
  },
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
  {
    id: 'updatedAt',
    header: 'Updated',
    cell: (item) => <TimeDisplay iso={item.updatedAt} format="date" />,
  },
  {
    id: 'detail',
    header: '',
    cell: (item) => (
      <Link to={item.id} className="button button--ghost button--compact">
        View
      </Link>
    ),
  },
];

export function InventoryListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

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
      <div className="toolbar" style={{ gap: '0.5rem' }}>
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
        <LoadingState
          liveRegion="off"
          title="Loading inventory"
          message="Fetching inventory data…"
        />
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
            debouncedProductId || debouncedVariantId
              ? 'No inventory items match the current filters.'
              : 'No inventory records have been synced yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Inventory items"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(item) => item.id}
          />

          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
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
