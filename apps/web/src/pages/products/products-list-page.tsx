import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useProductsQuery } from '../../features/products/hooks/use-products-query';
import type { Product, ProductFilters } from '../../features/products/api/products.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<Product>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (product) => product.name,
    accessor: (product) => product.name,
    sortable: true,
  },
  {
    id: 'sku',
    header: 'SKU',
    cell: (product) =>
      product.sku ? (
        <span className="mono-text" title={product.sku}>{product.sku}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
    accessor: (product) => product.sku,
    sortable: true,
    hideBelow: 768,
  },
  {
    id: 'price',
    header: 'Price',
    align: 'right',
    cell: (product) =>
      product.price !== null ? product.price.toFixed(2) : <span className="text-muted">—</span>,
    accessor: (product) => product.price,
    sortable: true,
    hideBelow: 480,
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (product) => <TimeDisplay iso={product.createdAt} format="date" />,
    accessor: (product) => product.createdAt,
    sortable: true,
    hideBelow: 1024,
  },
];

export function ProductsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'name', desc: false }]);

  const urlSearch = searchParams.get('search') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const filters: ProductFilters = { search: debouncedSearch || undefined };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useProductsQuery(filters, pagination);

  function handleSearchChange(value: string): void {
    setSearchInput(value);
    // Reset pagination immediately when typing
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('search', value);
      } else {
        next.delete('search');
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
      title="Products"
      description="Product catalog explorer — search by name or SKU."
    >
      {/* Search bar */}
      <div className="toolbar">
        <input
          aria-label="Search products by name or SKU"
          placeholder="Search by name or SKU…"
          value={searchInput}
          onChange={(e) => { handleSearchChange(e.target.value); }}
        />
      </div>

      {/* Table */}
      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading products"
          message="Fetching product catalog…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load products"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No products found"
          message={
            debouncedSearch
              ? 'No products match the current search. Try a different query.'
              : 'No products have been synced yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Products"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(product) => product.id}
            rowHref={(product) => product.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (product) => product.name,
              subtitle: (product) => product.sku ?? '—',
              meta: (product) => (product.price !== null ? product.price.toFixed(2) : null),
            }}
          />

          {/* Pagination */}
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
