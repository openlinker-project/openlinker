/**
 * Products List Page - catalog cockpit (#1720)
 *
 * Operator cockpit for the master catalog, absorbing the removed /inventory
 * list's cross-catalog stock browsing. Composes (orders-cockpit template):
 * - 4 KPI tiles that double as filters (Products / Out of stock / Low stock /
 *   Listing gaps), counted via limit:1 list probes (nav-counts precedent);
 * - a filter rail: debounced search, stock chips (out/low/oversold),
 *   per-connection "Unlisted on" chips, and a source-connection select -
 *   all URL-state-backed;
 * - a server-sorted DataTable (manualSorting + sort/dir URL params) with
 *   aggregated stock, per-connection listings coverage pills, a per-row
 *   "+ Create offers" CTA, and an expandable per-variant drawer
 *   (ProductRowDetail) with a per-connection listings breakdown;
 * - bulk selection of 1-100 products for batch offer creation (#739), with
 *   the capability-gated wizard launch (#1096) and write-access gate (#1704)
 *   carried over unchanged.
 *
 * @module apps/web/src/pages/products
 */
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Chip } from '../../shared/ui/chip';
import { Select } from '../../shared/ui/select';
import { MetricCard } from '../../shared/ui/metric-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../shared/ui/time-display';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { CheckboxCell } from '../../shared/ui/checkbox-cell';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { usePlatforms } from '../../shared/plugins';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { useProductsQuery } from '../../features/products/hooks/use-products-query';
import type {
  Product,
  ProductFilters,
  ProductListSort,
  ProductListSortDir,
  ProductListSortField,
  ProductStockFilter,
} from '../../features/products/api/products.types';
import {
  ProductListSortDirValues,
  ProductListSortFieldValues,
  ProductStockFilterValues,
} from '../../features/products/api/products.types';
import { useConnectionsQuery } from '../../features/connections';
import type { Connection } from '../../features/connections';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
} from './product-stock-status';
import { ListingsCoveragePills } from './listings-coverage-pills';
import { ProductRowDetail } from './product-row-detail';
import { MarketplacePickerModal } from './marketplace-picker-modal';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** Maximum products an operator can bulk-list in one batch (BE-enforced ceiling). */
export const BULK_SELECTION_CAP = 100;
/** limit:1 probe pagination shared by the KPI tiles (nav-counts precedent). */
const KPI_PROBE = { limit: 1 } as const;

// When currency is missing, the raw amount is shown muted with a hover-reveal
// rather than silently emitting a bare decimal — explicit ambiguity is safer.
function formatPrice(price: number | null, currency: string | null): ReactNode {
  if (price === null) {
    return <span className="text-muted">-</span>;
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

/** Type-guard for the `stock` URL param (widen-then-narrow, orders pattern). */
function isStockFilter(value: string | null): value is ProductStockFilter {
  return value !== null && (ProductStockFilterValues as readonly string[]).includes(value);
}

/** Type-guard for the `sort` URL param. */
function isSortField(value: string | null): value is ProductListSortField {
  return value !== null && (ProductListSortFieldValues as readonly string[]).includes(value);
}

/** Type-guard for the `dir` URL param. */
function isSortDir(value: string | null): value is ProductListSortDir {
  return value !== null && (ProductListSortDirValues as readonly string[]).includes(value);
}

const DEFAULT_SORT: ProductListSortField = 'createdAt';

/**
 * Sortable-column wiring (orders #944 pattern). `name` and `stock` are
 * DataTable-native sortable columns (1:1 column id -> server sort key).
 * `price` / `updatedAt` / `createdAt` share one merged "money" column with
 * its own per-label sort buttons (mirrors the orders sortstack) rather than
 * three separate DataTable columns, so they are sorted through
 * `handleMergedSort` directly instead of DataTable's own click handler.
 * `sku` remains a valid server sort key with no dedicated column at all.
 */
const SORTABLE_COLUMN_IDS: readonly ProductListSortField[] = ['name', 'stock'];

/** Sort keys rendered as stacked buttons in the merged Price/Updated/Created header. */
const MONEY_SORT_FIELDS: readonly ProductListSortField[] = ['price', 'updatedAt', 'createdAt'];
const MONEY_SORT_LABELS: Record<'price' | 'updatedAt' | 'createdAt', string> = {
  price: 'Price',
  updatedAt: 'Updated',
  createdAt: 'Created',
};

/** First-click direction per sort key; re-clicking the active column flips it. */
const DEFAULT_DIR: Record<ProductListSortField, ProductListSortDir> = {
  name: 'asc',
  sku: 'asc',
  price: 'desc',
  createdAt: 'desc',
  updatedAt: 'desc',
  stock: 'asc',
};

const STOCK_CHIPS: readonly { value: ProductStockFilter; label: string }[] = [
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'oversold', label: 'Oversold' },
];

/** Sort-field options for the collapsed-panel Sort control (narrow viewports). */
const SORT_OPTIONS: readonly { value: ProductListSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'sku', label: 'SKU' },
  { value: 'price', label: 'Price' },
  { value: 'stock', label: 'Stock' },
  { value: 'updatedAt', label: 'Updated' },
  { value: 'createdAt', label: 'Created' },
];

export function ProductsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const platforms = usePlatforms();

  // ── URL state ──────────────────────────────────────────────────────────
  const urlSearch = searchParams.get('search') ?? '';
  const rawStock = searchParams.get('stock');
  const stock = isStockFilter(rawStock) ? rawStock : undefined;
  const unlistedOnParam = searchParams.get('unlistedOn') ?? '';
  const unlistedOn = useMemo(
    () => (unlistedOnParam ? unlistedOnParam.split(',').filter(Boolean) : undefined),
    [unlistedOnParam],
  );
  const sourceConnectionId = searchParams.get('connectionId') ?? undefined;
  const rawSort = searchParams.get('sort');
  const sortField = isSortField(rawSort) ? rawSort : DEFAULT_SORT;
  const rawDir = searchParams.get('dir');
  const sortDir: ProductListSortDir = isSortDir(rawDir) ? rawDir : DEFAULT_DIR[sortField];
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // Narrow viewports collapse the inline filter rail into a "Filters" toggle
  // + panel (same media-query mechanic as DataTable's card switch, at the
  // 1024px boundary). Panel visibility is local UI state, collapsed by
  // default; the filters themselves stay URL state either way.
  const isNarrow = useMediaQuery('(max-width: 1023.98px)');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Selection state is component-local. It is *not* mirrored into URL params
  // during selection (the URL would balloon on every checkbox toggle, and the
  // common bulk-listing pattern is "select → submit", not "share a selection
  // link"). On submit click, the variant IDs are serialised into the wizard
  // route so the destination has the full list.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Mobile card disclosure (#1720): the variant/stock detail is heavy (its own
  // queries + a dense table), so it stays collapsed per-card until toggled -
  // rendering every card's detail open by default made the mobile list
  // unusable.
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  const toggleCardExpanded = useCallback((productId: string) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Set when the per-row "+ Create offers" CTA opened the picker for a single
  // product (instead of the bulk selection).
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  // Capability-gated create-offers action (#1096): select target connections by
  // the `OfferManager` capability — never a literal platformType. Display names
  // resolve through the plugin registry.
  const connectionsQuery = useConnectionsQuery();
  // The bulk "Create offers" CTA opens the bulk wizard whose final submit is a
  // `listings:write` action; gate the CTA on `write.visible` so a genuinely
  // unauthorized (non-demo) viewer never sees it, while a demo viewer sees it
  // enabled and hits the gated confirm step (#1704).
  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);
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
  const offerCreatorIds = useMemo(
    () => offerManagerConnections.map((c) => c.id),
    [offerManagerConnections],
  );
  const gapsCsv = offerCreatorIds.join(',');

  // Source select lists ALL active connections (any capability); the cockpit
  // source axis is about provenance, not offer creation.
  const activeConnections = useMemo(
    () => (connectionsQuery.data ?? []).filter((c) => c.status === 'active'),
    [connectionsQuery.data],
  );
  const connectionById = useMemo(() => {
    const map = new Map<string, Connection>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [connectionsQuery.data]);

  const platformLabel = useCallback(
    (platformType: string): string =>
      platforms.find((p) => p.platformType === platformType)?.displayName ?? platformType,
    [platforms],
  );

  // ── Server queries ─────────────────────────────────────────────────────
  const filters: ProductFilters = {
    search: debouncedSearch || undefined,
    stock,
    unlistedOn,
    connectionId: sourceConnectionId,
  };
  const sort: ProductListSort = { field: sortField, dir: sortDir };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useProductsQuery(filters, pagination, sort);
  const items = query.data?.items ?? [];

  // KPI tile counts — four cheap limit:1 probes with distinct query keys
  // (nav-counts precedent). The gaps probe is disabled with zero OfferCreator
  // connections (its filter would be meaningless).
  const allProbe = useProductsQuery(undefined, KPI_PROBE);
  const outProbe = useProductsQuery({ stock: 'out' }, KPI_PROBE);
  const lowProbe = useProductsQuery({ stock: 'low' }, KPI_PROBE);
  const gapsFilters = useMemo<ProductFilters>(
    () => ({ unlistedOn: offerCreatorIds }),
    [offerCreatorIds],
  );
  const gapsProbe = useProductsQuery(gapsFilters, KPI_PROBE, undefined, {
    enabled: offerCreatorIds.length > 0,
  });

  const probeValue = (total: number | undefined): string =>
    total === undefined ? '-' : String(total);

  // ── URL param setters ──────────────────────────────────────────────────
  /** Set/clear one filter param and reset paging (orders pattern). */
  const setFilterParam = useCallback(
    (key: string, value: string): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (value) {
          p.set(key, value);
        } else {
          p.delete(key);
        }
        p.delete('offset');
        return p;
      });
    },
    [setSearchParams],
  );

  const toggleStock = useCallback(
    (value: ProductStockFilter): void => {
      setFilterParam('stock', stock === value ? '' : value);
    },
    [setFilterParam, stock],
  );

  const toggleUnlistedOn = useCallback(
    (csv: string): void => {
      setFilterParam('unlistedOn', unlistedOnParam === csv ? '' : csv);
    },
    [setFilterParam, unlistedOnParam],
  );

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

  /** Explicit sort write for the collapsed-panel Sort control. */
  const setSort = useCallback(
    (field: ProductListSortField, dir: ProductListSortDir): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('sort', field);
        p.set('dir', dir);
        p.delete('offset');
        return p;
      });
    },
    [setSearchParams],
  );

  /**
   * Click handler for a per-label sort button inside the merged Price /
   * Updated / Created header cell (same same-column-flips / new-column-
   * defaults semantics as DataTable's own sortable-column click handler).
   */
  const handleMergedSort = useCallback(
    (field: ProductListSortField): void => {
      const nextDir = field === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[field];
      setSort(field, nextDir);
    },
    [sortField, sortDir, setSort],
  );

  const anyFilterActive = Boolean(
    debouncedSearch || stock || unlistedOnParam || sourceConnectionId,
  );
  // Count badge on the narrow-viewport "Filters" toggle - non-default filter
  // axes only (search stays visible outside the panel).
  const activeFilterCount =
    (stock ? 1 : 0) + (unlistedOnParam ? 1 : 0) + (sourceConnectionId ? 1 : 0);

  const clearFilters = useCallback((): void => {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('stock');
      next.delete('unlistedOn');
      next.delete('connectionId');
      next.delete('offset');
      return next;
    });
  }, [setSearchParams]);

  // ── Bulk selection (#739) ──────────────────────────────────────────────
  const handleToggleRow = useCallback((productId: string) => {
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
  }, []);

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

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // On submit: serialise product ids into the wizard URL. The wizard page
  // consumes ?productIds= and hydrates products + variants from there; it
  // resolves each product to its primary variant before calling the BE
  // bulk-create endpoint. `connectionId` (when known — exactly-one or
  // picker-chosen) preselects the wizard's connection (#1096).
  const goToWizard = useCallback(
    (productIds: readonly string[], connectionId?: string) => {
      if (productIds.length === 0) return;
      const params = new URLSearchParams({ productIds: productIds.join(',') });
      if (connectionId) params.set('connectionId', connectionId);
      void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
    },
    [navigate],
  );

  // Capability-aware bulk launch: 1 connection → straight to wizard
  // (preselected); 2+ → marketplace-picker modal. (0 hides the action.)
  const handleCreateOffers = useCallback(() => {
    if (offerManagerConnections.length === 1) {
      goToWizard(Array.from(selectedIds), offerManagerConnections[0]!.id);
    } else if (offerManagerConnections.length > 1) {
      setPendingProductId(null);
      setPickerOpen(true);
    }
  }, [offerManagerConnections, goToWizard, selectedIds]);

  // Per-row "+ Create offers" CTA — same launch, single product preselected.
  const handleCreateOffersForProduct = useCallback(
    (productId: string) => {
      if (offerManagerConnections.length === 1) {
        goToWizard([productId], offerManagerConnections[0]!.id);
      } else if (offerManagerConnections.length > 1) {
        setPendingProductId(productId);
        setPickerOpen(true);
      }
    },
    [offerManagerConnections, goToWizard],
  );

  const soleConnectionName =
    offerManagerConnections.length === 1
      ? (platforms.find((p) => p.platformType === offerManagerConnections[0]!.platformType)
          ?.displayName ?? offerManagerConnections[0]!.platformType)
      : null;

  const atCap = selectedIds.size >= BULK_SELECTION_CAP;

  /**
   * Row gap detection for the per-row CTA: any active OfferCreator connection
   * covering fewer variants than the product has. Requires the BE-enriched
   * `variantCount`; rows without it (older payloads) render no CTA.
   */
  const hasListingGap = useCallback(
    (product: Product): boolean => {
      const variantCount = product.variantCount ?? 0;
      if (variantCount === 0 || offerManagerConnections.length === 0) return false;
      const listedByConnection = new Map(
        (product.listingsCoverage ?? []).map((c) => [c.connectionId, c.listedVariants]),
      );
      return offerManagerConnections.some(
        (c) => (listedByConnection.get(c.id) ?? 0) < variantCount,
      );
    },
    [offerManagerConnections],
  );

  /** Shared by the desktop select column and mobile card select slot. */
  const renderSelectCheckbox = useCallback(
    (product: Product): ReactElement => {
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
          tooltip={disabled ? `Max ${BULK_SELECTION_CAP} per batch` : undefined}
        />
      );
    },
    [selectedIds, atCap, handleToggleRow],
  );

  const renderStockCell = useCallback((product: Product): ReactNode => {
    if (product.totalAvailable === undefined) {
      return <span className="text-muted">-</span>;
    }
    const status = deriveStockStatus(product.totalAvailable);
    return (
      <span className="products-cell-stack">
        <span className="products-stock-value mono tabular">{product.totalAvailable}</span>
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
        {(product.totalReserved ?? 0) > 0 ? (
          <span className="text-muted products-cell-sub tabular">
            reserved {product.totalReserved}
          </span>
        ) : null}
      </span>
    );
  }, []);

  const renderCoveragePills = useCallback(
    (product: Product): ReactNode => (
      <ListingsCoveragePills
        coverage={product.listingsCoverage}
        variantCount={product.variantCount ?? 0}
        connections={offerManagerConnections}
      />
    ),
    [offerManagerConnections],
  );

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
        cell: (product) => renderSelectCheckbox(product),
        align: 'left',
      },
      {
        id: 'name',
        header: 'Product',
        sortable: true,
        cell: (product) => (
          <span className="product-row">
            <ProductThumbnail src={product.images?.[0]} name={product.name} />
            <span className="products-cell-stack">
              <span className="ds-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                <Link to={product.id} className="product-row__name product-row__name--link">
                  {product.name}
                </Link>
                {(product.variantCount ?? 0) > 1 ? (
                  <StatusBadge tone="neutral" compact>
                    {product.variantCount} variants
                  </StatusBadge>
                ) : null}
              </span>
              {product.sku ? (
                <span className="text-muted products-cell-sub mono-text" title={product.sku}>
                  {product.sku}
                </span>
              ) : null}
            </span>
          </span>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        hideBelow: 1024,
        cell: (product): ReactNode => {
          const origin = product.externalIds?.[0];
          if (!origin) return <span className="text-muted">-</span>;
          const connectionName = connectionById.get(origin.connectionId)?.name;
          return (
            <span className="products-cell-stack">
              <span className="channel-pill" data-channel={origin.platformType}>
                {platformLabel(origin.platformType)}
              </span>
              {connectionName ? (
                <span className="text-muted products-cell-sub">{connectionName}</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'stock',
        header: 'Stock',
        sortable: true,
        cell: (product) => renderStockCell(product),
      },
      {
        id: 'listings',
        header: 'Listings',
        cell: (product) => (
          <span className="products-cell-stack">
            {renderCoveragePills(product)}
            {write.visible && hasListingGap(product) ? (
              <Button
                tone="ghost"
                className="button--sm products-row-cta"
                onClick={() => {
                  handleCreateOffersForProduct(product.id);
                }}
              >
                + Create offers
              </Button>
            ) : null}
          </span>
        ),
      },
      {
        id: 'money',
        header: (
          <span className="sortstack">
            {MONEY_SORT_FIELDS.map((field) => (
              <button
                key={field}
                type="button"
                className={`sortbtn${sortField === field ? ' sortbtn--active' : ''}`}
                onClick={() => { handleMergedSort(field); }}
              >
                {MONEY_SORT_LABELS[field as 'price' | 'updatedAt' | 'createdAt']}
                <span className="sortbtn__ind" aria-hidden="true">
                  {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                </span>
              </button>
            ))}
          </span>
        ),
        align: 'right',
        cell: (product) => (
          <span className="products-cell-stack products-cell-stack--end">
            <span className="mono tabular products-stock-value">
              {formatPrice(product.price, product.currency)}
            </span>
            <span className="products-cell-sub products-cell-sub--date mono tabular">
              upd. <TimeDisplay iso={product.updatedAt} format="date" />
            </span>
            <span className="products-cell-sub products-cell-sub--date mono tabular">
              <TimeDisplay iso={product.createdAt} format="date" />
            </span>
          </span>
        ),
        hideBelow: 480,
      },
    ],
    [
      headerCheckboxState,
      handleToggleHeader,
      renderSelectCheckbox,
      renderStockCell,
      renderCoveragePills,
      connectionById,
      platformLabel,
      write.visible,
      hasListingGap,
      handleCreateOffersForProduct,
    ],
  );

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Controlled (server-side) sort state for the DataTable: the active sort
  // key maps 1:1 to its column id when that column is visible/sortable; the
  // default createdAt ordering highlights no header.
  const sortingState = (SORTABLE_COLUMN_IDS as readonly string[]).includes(sortField)
    ? [{ id: sortField, desc: sortDir === 'desc' }]
    : [];

  const gapsActive = unlistedOnParam !== '' && unlistedOnParam === gapsCsv;
  const noKpiFilterActive = stock === undefined && unlistedOnParam === '';

  return (
    <PageLayout
      eyebrow="Operations"
      title="Products"
      description="Catalog cockpit — search, stock health, and per-channel listings coverage. Select up to 100 products to bulk-create offers."
    >
      {/* KPI tiles double as filters (orders-segments mechanic). */}
      <div className="ds-grid ds-grid--4 products-segments">
        <button
          type="button"
          className={['products-segment', noKpiFilterActive ? 'products-segment--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={noKpiFilterActive}
          onClick={() => {
            setSearchParams((prev) => {
              const p = new URLSearchParams(prev);
              p.delete('stock');
              p.delete('unlistedOn');
              p.delete('offset');
              return p;
            });
          }}
        >
          <MetricCard label="Products" value={probeValue(allProbe.data?.total)} />
        </button>
        <button
          type="button"
          className={['products-segment', stock === 'out' ? 'products-segment--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={stock === 'out'}
          onClick={() => {
            toggleStock('out');
          }}
        >
          <MetricCard
            label="Out of stock"
            tone={(outProbe.data?.total ?? 0) > 0 ? 'error' : 'neutral'}
            value={probeValue(outProbe.data?.total)}
          />
        </button>
        <button
          type="button"
          className={['products-segment', stock === 'low' ? 'products-segment--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={stock === 'low'}
          onClick={() => {
            toggleStock('low');
          }}
        >
          <MetricCard
            label="Low stock"
            tone={(lowProbe.data?.total ?? 0) > 0 ? 'warning' : 'neutral'}
            value={probeValue(lowProbe.data?.total)}
          />
        </button>
        {offerCreatorIds.length > 0 ? (
          <button
            type="button"
            className={['products-segment', gapsActive ? 'products-segment--active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={gapsActive}
            onClick={() => {
              toggleUnlistedOn(gapsCsv);
            }}
          >
            <MetricCard
              label="Listing gaps"
              tone={(gapsProbe.data?.total ?? 0) > 0 ? 'info' : 'neutral'}
              value={probeValue(gapsProbe.data?.total)}
            />
          </button>
        ) : null}
      </div>

      {/* Filter rail — search + source select + chips, all URL-synced. Below
          1024px the chips/select/sort collapse behind a "Filters" toggle so
          the rail doesn't wrap into a multi-row block above the table; only
          the search input stays inline. */}
      <div className="toolbar products-toolbar">
        <Input
          aria-label="Search products by name or SKU"
          placeholder="Search by name or SKU…"
          value={searchInput}
          onChange={(e) => {
            handleSearchChange(e.target.value);
          }}
        />
        {isNarrow ? (
          <button
            type="button"
            className={[
              'products-filter-toggle',
              activeFilterCount > 0 ? 'products-filter-toggle--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-expanded={filtersOpen}
            onClick={() => {
              setFiltersOpen((open) => !open);
            }}
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className="products-filter-toggle__count tabular">{activeFilterCount}</span>
            ) : null}
            <span aria-hidden="true">{filtersOpen ? '▾' : '▸'}</span>
          </button>
        ) : (
          <>
            <Select
              aria-label="Filter by source connection"
              value={sourceConnectionId ?? ''}
              onChange={(e) => {
                setFilterParam('connectionId', e.target.value);
              }}
            >
              <option value="">Source: All connections</option>
              {activeConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {anyFilterActive ? (
              <Button tone="ghost" className="button--sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </>
        )}
      </div>

      {!isNarrow ? (
        <div
          className="ds-row"
          style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Chip
            tone="neutral"
            active={stock === undefined}
            onClick={() => { setFilterParam('stock', ''); }}
          >
            All {total}
          </Chip>
          {STOCK_CHIPS.map((chip) => (
            <Chip
              key={chip.value}
              tone={chip.value === 'low' ? 'warning' : 'error'}
              active={stock === chip.value}
              onClick={() => {
                toggleStock(chip.value);
              }}
            >
              {chip.label}
            </Chip>
          ))}
          {offerManagerConnections.map((c) => (
            <Chip
              key={c.id}
              tone="info"
              active={unlistedOnParam === c.id}
              onClick={() => {
                toggleUnlistedOn(c.id);
              }}
            >
              Unlisted on {c.name}
            </Chip>
          ))}
          {query.data ? (
            <span
              className="text-muted mono tabular"
              style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
            >
              {query.data.total.toLocaleString()} results
            </span>
          ) : null}
        </div>
      ) : null}

      {isNarrow && filtersOpen ? (
        <div className="products-filter-panel">
          <div className="products-filter-panel__group">
            <span className="products-filter-panel__label">Stock</span>
            <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Chip
                tone="neutral"
                active={stock === undefined}
                onClick={() => { setFilterParam('stock', ''); }}
              >
                All {total}
              </Chip>
              {STOCK_CHIPS.map((chip) => (
                <Chip
                  key={chip.value}
                  tone={chip.value === 'low' ? 'warning' : 'error'}
                  active={stock === chip.value}
                  onClick={() => {
                    toggleStock(chip.value);
                  }}
                >
                  {chip.label}
                </Chip>
              ))}
            </div>
          </div>
          {offerManagerConnections.length > 0 ? (
            <div className="products-filter-panel__group">
              <span className="products-filter-panel__label">Listings</span>
              <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {offerManagerConnections.map((c) => (
                  <Chip
                    key={c.id}
                    tone="info"
                    active={unlistedOnParam === c.id}
                    onClick={() => {
                      toggleUnlistedOn(c.id);
                    }}
                  >
                    Unlisted on {c.name}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          <div className="products-filter-panel__group">
            <span className="products-filter-panel__label">Source</span>
            <Select
              aria-label="Filter by source connection"
              value={sourceConnectionId ?? ''}
              onChange={(e) => {
                setFilterParam('connectionId', e.target.value);
              }}
            >
              <option value="">Source: All connections</option>
              {activeConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {/* Sort moves into the panel below 1024px: the sortable Source /
              Updated columns are hidden there (hideBelow), so headers alone
              can no longer reach every sort axis. */}
          <div className="products-filter-panel__group">
            <span className="products-filter-panel__label">Sort</span>
            <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Select
                aria-label="Sort by"
                value={sortField}
                onChange={(e) => {
                  const field = e.target.value;
                  if (isSortField(field)) setSort(field, DEFAULT_DIR[field]);
                }}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Chip
                active={sortDir === 'asc'}
                onClick={() => {
                  setSort(sortField, 'asc');
                }}
              >
                Asc
              </Chip>
              <Chip
                active={sortDir === 'desc'}
                onClick={() => {
                  setSort(sortField, 'desc');
                }}
              >
                Desc
              </Chip>
            </div>
          </div>
          {anyFilterActive ? (
            <div className="products-filter-panel__group">
              <Button tone="ghost" className="button--sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

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
            anyFilterActive
              ? 'No products match the current filters.'
              : 'No products have been synced yet.'
          }
          action={
            anyFilterActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
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
            manualSorting
            sort={sortingState}
            onSortChange={(updater) => {
              // Server-side sort (orders #944 pattern): resolve the clicked
              // column, then apply our own asc/desc toggle — same column
              // flips, a new column starts at its default direction.
              const next = typeof updater === 'function' ? updater(sortingState) : updater;
              const clickedColumnId = next.length > 0 ? next[0].id : sortField;
              if (!isSortField(clickedColumnId)) return;
              const nextDir: ProductListSortDir =
                clickedColumnId === sortField
                  ? sortDir === 'asc'
                    ? 'desc'
                    : 'asc'
                  : DEFAULT_DIR[clickedColumnId];
              setSearchParams((prev) => {
                const p = new URLSearchParams(prev);
                p.set('sort', clickedColumnId);
                p.set('dir', nextDir);
                p.delete('offset');
                return p;
              });
            }}
            expandable={{
              renderDetail: (product) => (
                <ProductRowDetail
                  product={product}
                  connections={offerManagerConnections}
                  canCreateOffers={write.visible}
                  onCreateOffers={handleCreateOffersForProduct}
                />
              ),
              toggleLabel: (product, expanded) =>
                `${expanded ? 'Collapse' : 'Expand'} variant stock for ${product.name}`,
            }}
            cardView={{
              select: (product) => renderSelectCheckbox(product),
              title: (product) => (
                <span className="product-row">
                  <ProductThumbnail src={product.images?.[0]} name={product.name} size="sm" />
                  {/* Unlike the desktop column cell, the card has no fixed
                      width to truncate against - wrap the full name instead
                      of clipping it with no visible ellipsis (#1720 review). */}
                  <span className="product-row__name product-row__name--wrap">{product.name}</span>
                </span>
              ),
              subtitle: (product) => product.sku ?? '-',
              meta: (product) => (
                <span className="data-table__badge-row">
                  {product.price !== null ? (
                    <span className="mono tabular">
                      {formatPrice(product.price, product.currency)}
                    </span>
                  ) : null}
                  {product.totalAvailable !== undefined ? (
                    <StatusBadge
                      tone={STOCK_STATUS_BADGE_TONE[deriveStockStatus(product.totalAvailable)]}
                      withDot
                      compact
                    >
                      {STOCK_STATUS_LABEL[deriveStockStatus(product.totalAvailable)]}
                    </StatusBadge>
                  ) : null}
                  {renderCoveragePills(product)}
                </span>
              ),
              detail: (product) => {
                const expanded = expandedCardIds.has(product.id);
                return (
                  <>
                    <button
                      type="button"
                      className="products-card-disclosure"
                      aria-expanded={expanded}
                      onClick={() => { toggleCardExpanded(product.id); }}
                    >
                      <span className="products-card-disclosure__chev" aria-hidden="true">
                        {expanded ? '▾' : '▸'}
                      </span>
                      {product.variantCount ?? 1} variant{(product.variantCount ?? 1) === 1 ? '' : 's'}
                    </button>
                    {expanded ? (
                      <ProductRowDetail
                        product={product}
                        connections={offerManagerConnections}
                        canCreateOffers={write.visible}
                        onCreateOffers={handleCreateOffersForProduct}
                      />
                    ) : null}
                  </>
                );
              },
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
                {offerManagerConnections.length > 0 && write.visible ? (
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
            onOpenChange={(open) => {
              setPickerOpen(open);
              if (!open) setPendingProductId(null);
            }}
            productCount={pendingProductId ? 1 : selectedIds.size}
            connections={offerManagerConnections}
            onContinue={(connectionId) => {
              setPickerOpen(false);
              const ids = pendingProductId ? [pendingProductId] : Array.from(selectedIds);
              setPendingProductId(null);
              goToWizard(ids, connectionId);
            }}
          />
        </>
      )}
    </PageLayout>
  );
}
