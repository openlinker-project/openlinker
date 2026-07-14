/**
 * Products List Page
 *
 * Browseable catalog of products synced from connected platforms. Supports
 * search + pagination via URL params, and bulk selection of 1-100 products
 * for batch Allegro listing creation (#739). Selection state is component-
 * local; it is serialised into the wizard URL only on navigation so the
 * URL doesn't grow on every checkbox toggle.
 *
 * @module apps/web/src/pages/products
 */
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../shared/ui/time-display';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { CheckboxCell } from '../../shared/ui/checkbox-cell';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { usePlatforms } from '../../shared/plugins';
import { useProductsQuery } from '../../features/products/hooks/use-products-query';
import type { Product, ProductFilters } from '../../features/products/api/products.types';
import { useConnectionsQuery } from '../../features/connections';
import type { Connection } from '../../features/connections';
import { MarketplacePickerModal } from './marketplace-picker-modal';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** Maximum products an operator can bulk-list in one batch (BE-enforced ceiling). */
export const BULK_SELECTION_CAP = 100;

// When currency is missing, the raw amount is shown muted with a hover-reveal
// rather than silently emitting a bare decimal — explicit ambiguity is safer.
function formatPrice(price: number | null, currency: string | null): ReactNode {
  if (price === null) {
    return <span className="text-muted">—</span>;
  }
  if (currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  }
  return (
    <span className="text-muted" title="Currency unknown">
      {price.toFixed(2)}
    </span>
  );
}

export function ProductsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { sort, setSort } = useTableSort([{ id: 'name', desc: false }]);

  const urlSearch = searchParams.get('search') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // Selection state is component-local. It is *not* mirrored into URL params
  // during selection (the URL would balloon on every checkbox toggle, and the
  // common bulk-listing pattern is "select → submit", not "share a selection
  // link"). On submit click, the variant IDs are serialised into the wizard
  // route so the destination has the full list.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Capability-gated create-offers action (#1096): select target connections by
  // the `OfferManager` capability — never a literal platformType. Display names
  // resolve through the plugin registry.
  const connectionsQuery = useConnectionsQuery();
  const platforms = usePlatforms();
  const offerManagerConnections = useMemo<Connection[]>(
    () =>
      (connectionsQuery.data ?? [])
        // OfferCreator (not coarse OfferManager, #1498): a quantity-only
        // OfferManager (WooCommerce stock write-back) must not surface in
        // offer-creation flows.
        .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [connectionsQuery.data],
  );

  const filters: ProductFilters = { search: debouncedSearch || undefined };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useProductsQuery(filters, pagination);
  const items = query.data?.items ?? [];

  const handleToggleRow = useCallback(
    (productId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(productId)) {
          next.delete(productId);
          return next;
        }
        // Enforce the cap by refusing the toggle when at capacity.
        if (next.size >= BULK_SELECTION_CAP) {
          return prev;
        }
        next.add(productId);
        return next;
      });
    },
    [],
  );

  const visibleIds = useMemo(() => items.map((p) => p.id), [items]);
  const visibleSelectedCount = useMemo(
    () => visibleIds.reduce((sum, id) => sum + (selectedIds.has(id) ? 1 : 0), 0),
    [visibleIds, selectedIds],
  );

  const headerCheckboxState =
    visibleIds.length > 0 && visibleSelectedCount === visibleIds.length
      ? 'all'
      : visibleSelectedCount > 0
        ? 'some'
        : 'none';

  const handleToggleHeader = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (headerCheckboxState === 'all') {
        // Unselect everything visible on the current page; keep other-page
        // selections intact so paginating through doesn't lose state.
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      // Select all visible, respecting the cap. If selecting all would
      // exceed the cap, select up to the cap and stop — caller already
      // sees disabled checkboxes for over-cap rows.
      for (const id of visibleIds) {
        if (next.has(id)) continue;
        if (next.size >= BULK_SELECTION_CAP) break;
        next.add(id);
      }
      return next;
    });
  }, [headerCheckboxState, visibleIds]);

  const handleSearchChange = useCallback(
    (value: string): void => {
      setSearchInput(value);
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
    },
    [setSearchParams],
  );

  const setOffset = useCallback(
    (nextOffset: number): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (nextOffset === 0) {
          p.delete('offset');
        } else {
          p.set('offset', String(nextOffset));
        }
        return p;
      });
    },
    [setSearchParams],
  );

  const clearSearch = useCallback((): void => {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('offset');
      return next;
    });
  }, [setSearchParams]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // On submit: serialise the selection into the wizard URL. The wizard
  // page consumes ?productIds= and hydrates products + variants from there.
  // We send product IDs; the wizard resolves each to its primary variant
  // before calling the BE bulk-create endpoint (which actually accepts
  // variant IDs — see bulk-listings.types.ts file header). `connectionId`
  // (when known — exactly-one or picker-chosen) preselects the wizard's
  // connection (#1096).
  const goToWizard = useCallback(
    (connectionId?: string) => {
      if (selectedIds.size === 0) return;
      const ids = Array.from(selectedIds).join(',');
      const params = new URLSearchParams({ productIds: ids });
      if (connectionId) params.set('connectionId', connectionId);
      void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
    },
    [selectedIds, navigate],
  );

  // Capability-aware launch: 1 connection → straight to wizard (preselected);
  // 2+ → marketplace-picker modal. (0 is handled by hiding the action.)
  const handleCreateOffers = useCallback(() => {
    if (offerManagerConnections.length === 1) {
      goToWizard(offerManagerConnections[0]!.id);
    } else if (offerManagerConnections.length > 1) {
      setPickerOpen(true);
    }
  }, [offerManagerConnections, goToWizard]);

  const soleConnectionName =
    offerManagerConnections.length === 1
      ? (platforms.find((p) => p.platformType === offerManagerConnections[0]!.platformType)
          ?.displayName ?? offerManagerConnections[0]!.platformType)
      : null;

  const atCap = selectedIds.size >= BULK_SELECTION_CAP;

  const columns: DataTableColumn<Product>[] = useMemo(
    () => [
      {
        id: 'select',
        // Header rendered manually for indeterminate state.
        header: (
          <CheckboxCell
            state={headerCheckboxState}
            onToggle={handleToggleHeader}
            ariaLabel={
              headerCheckboxState === 'all'
                ? 'Unselect all visible products'
                : 'Select all visible products'
            }
          />
        ),
        cell: (product) => {
          const checked = selectedIds.has(product.id);
          const disabled = !checked && atCap;
          return (
            <CheckboxCell
              state={checked ? 'all' : 'none'}
              onToggle={() => {
                handleToggleRow(product.id);
              }}
              disabled={disabled}
              ariaLabel={
                checked
                  ? `Unselect ${product.name}`
                  : disabled
                    ? `Maximum ${BULK_SELECTION_CAP} products per batch reached`
                    : `Select ${product.name}`
              }
              tooltip={
                disabled ? `Max ${BULK_SELECTION_CAP} per batch` : undefined
              }
            />
          );
        },
        align: 'left',
      },
      {
        id: 'name',
        header: 'Name',
        cell: (product) => (
          <span className="product-row">
            <ProductThumbnail src={product.images?.[0]} name={product.name} />
            <Link to={product.id} className="product-row__name product-row__name--link">
              {product.name}
            </Link>
          </span>
        ),
        accessor: (product) => product.name,
        sortable: true,
      },
      {
        id: 'sku',
        header: 'SKU',
        cell: (product) =>
          product.sku ? (
            <span className="mono-text" title={product.sku}>
              {product.sku}
            </span>
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
        cell: (product) => formatPrice(product.price, product.currency),
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
    ],
    [selectedIds, atCap, headerCheckboxState, handleToggleRow, handleToggleHeader],
  );

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Products"
      description="Product catalog explorer — search by name or SKU. Select up to 100 products to bulk-list on Allegro."
    >
      <div className="toolbar">
        <Input
          aria-label="Search products by name or SKU"
          placeholder="Search by name or SKU…"
          value={searchInput}
          onChange={(e) => {
            handleSearchChange(e.target.value);
          }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load products"
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No products found"
          message={
            debouncedSearch
              ? 'No products match the current search.'
              : 'No products have been synced yet.'
          }
          action={
            debouncedSearch ? (
              <Button onClick={clearSearch}>Clear search</Button>
            ) : (
              <Link className="button button--primary" to="/connections">
                Manage connections
              </Link>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption="Products"
            columns={columns}
            rows={items}
            rowKey={(product) => product.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (product) => (
                <span className="product-row">
                  <ProductThumbnail src={product.images?.[0]} name={product.name} size="sm" />
                  <span className="product-row__name">{product.name}</span>
                </span>
              ),
              subtitle: (product) => product.sku ?? '—',
              meta: (product) =>
                product.price !== null ? formatPrice(product.price, product.currency) : null,
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

          <BulkActionBar
            count={selectedIds.size}
            itemNoun="product"
            hint={
              atCap
                ? `Max ${BULK_SELECTION_CAP} per batch`
                : `Max ${BULK_SELECTION_CAP} per batch · ${BULK_SELECTION_CAP - selectedIds.size} more available`
            }
            actions={
              <>
                <Button tone="ghost" className="button--sm" onClick={clearSelection}>
                  Clear
                </Button>
                {/* Capability-gated (#1096): hidden with 0 OfferManager connections. */}
                {offerManagerConnections.length > 0 ? (
                  <Button tone="primary" onClick={handleCreateOffers}>
                    {soleConnectionName
                      ? `Create ${soleConnectionName} offers (${selectedIds.size.toLocaleString()})`
                      : `Create offers (${selectedIds.size.toLocaleString()})`}
                  </Button>
                ) : null}
              </>
            }
          />

          <MarketplacePickerModal
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            productCount={selectedIds.size}
            connections={offerManagerConnections}
            onContinue={(connectionId) => {
              setPickerOpen(false);
              goToWizard(connectionId);
            }}
          />
        </>
      )}
    </PageLayout>
  );
}
