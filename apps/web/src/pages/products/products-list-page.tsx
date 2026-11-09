/**
 * Products List Page - catalog cockpit (#1720)
 *
 * Operator cockpit for the master catalog, absorbing the removed /inventory
 * list's cross-catalog stock browsing. Same filter system as the orders list
 * (#4026, #4027):
 * - stock tabs (All / Out of stock / Low stock / Oversold) and "Needs a look"
 *   (listing gaps, no tax rate, no cost price), counted through
 *   `GET /products/count` (useProductCountProbes, #2947);
 * - a toolbar: debounced search, Source / Listings / Tax rate / Filters, the
 *   results count and a Sort menu, with the applied filters as pills - all
 *   URL-state-backed;
 * - a server-sorted DataTable (sort/dir URL params, stacked sort headers) with
 *   aggregated stock, per-connection listings coverage pills and a per-row
 *   "+ Publish" CTA; a row click or the arrow column opens the product peek
 *   (ProductPeek) with the per-variant listings breakdown;
 * - bulk selection of 1-100 products for batch offer creation (#739), with
 *   the capability-gated wizard launch (#1096) and write-access gate (#1704)
 *   carried over unchanged.
 *
 * Row identity follows the shared cells (#2092, epic #2086): the sub-line under
 * the product name is a labelled `SKU: <value>` (a bare mono string does not say
 * which kind of identifier it is), and the Source column renders the shared
 * `ConnectionCell` with the channel pill as its adornment — resolved name over a
 * shortened, copyable connection id, fed from ONE batched connections read.
 *
 * @module apps/web/src/pages/products
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Alert } from '../../shared/ui/alert';
import { StatusBadge } from '../../shared/ui/status-badge';
import { ProductThumbnail } from '../../shared/ui/product-thumbnail';
import { TimeDisplay } from '../../shared/ui/time-display';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { CheckboxCell } from '../../shared/ui/checkbox-cell';
import { StatusTabs, type StatusTab } from '../../shared/ui/status-tabs';
import { PeekArrow } from '../../shared/ui/capped-badges';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { formatAmount } from '../../shared/format/format-amount';
import { ListPagination } from '../../shared/ui/list-pagination';
import {
  ConnectionCell,
  ConnectionChip,
  ConnectionFold,
  readConnectionEnvironment,
  useConnectionsQuery,
} from '../../features/connections';
import type { Connection, ConnectionChipChannel } from '../../features/connections';
import { selectPublishDestinations } from '../../features/listings';
import {
  deriveProductStaleness,
  deriveStockStatus,
  ProductAttentionSummary,
  ProductListSortDirValues,
  ProductListSortFieldValues,
  ProductStockFilterValues,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_LABEL,
  useCostCoverageQuery,
  useProductCountProbes,
  useProductRowsQuery,
  useProductsTotal,
  type Product,
  type ProductCountProbe,
  type ProductFilters,
  type ProductListSort,
  type ProductListSortDir,
  type ProductListSortField,
  type ProductStockFilter,
} from '../../features/products';
import { deriveAtpStatus } from '../../features/inventory';
import {
  interpolate,
  renderRich,
  useFormat,
  useMessages,
  usePlural,
  type Formatters,
} from '../../shared/i18n';
import { useTrackMargin } from '../../features/analytics';
import { ListingsCoveragePills } from './listings-coverage-pills';
import { ProductRowDetail } from './product-row-detail';
import { ProductPeek, ProductTaxRateBadge, type ProductPeekView } from './product-peek';
import { ProductsFilterBar } from './products-filter-bar';
import { OfferProductPickerModal } from '../../features/listings/components/offer-product-picker-modal';
import { bucketCount, captureDemoEvent } from '../../features/demo';
import {
  ATTENTION_REASON_COPY,
  attentionTitle,
  useOmsAttentionQuery,
} from '../../features/fulfillment-authority';
import { describeApiError } from '../../shared/api/describe-api-error';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** Maximum products an operator can bulk-list in one batch (BE-enforced ceiling). */
export const BULK_SELECTION_CAP = 100;

// When currency is missing, the raw amount is shown muted with a hover-reveal
// rather than silently emitting a bare decimal — explicit ambiguity is safer.
function formatPrice(
  price: number | null,
  currency: string | null,
  currencyUnknownLabel: string,
  format: Formatters,
): ReactNode {
  if (price === null) {
    return <span className="text-muted">-</span>;
  }
  if (currency) {
    return formatAmount(price, currency);
  }
  return (
    <span className="text-muted" title={currencyUnknownLabel}>
      {format.number(price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
 * Every sortable header is a stack of per-label sort buttons (the orders
 * sortstack, #4026): Product + SKU, Stock, and Price / Updated / Created. A
 * click on the active key flips it; another key starts at its default.
 */
const PRODUCT_SORT_FIELDS: readonly ProductListSortField[] = ['name', 'sku'];
const STOCK_SORT_FIELDS: readonly ProductListSortField[] = ['stock'];
const MONEY_SORT_FIELDS: readonly ProductListSortField[] = ['price', 'updatedAt', 'createdAt'];

/** First-click direction per sort key; re-clicking the active column flips it. */
const DEFAULT_DIR: Record<ProductListSortField, ProductListSortDir> = {
  name: 'asc',
  sku: 'asc',
  price: 'desc',
  createdAt: 'desc',
  updatedAt: 'desc',
  stock: 'asc',
};



export function ProductsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const platforms = usePlatforms();
  const copy = useMessages('products').productsListPage;
  const plural = usePlural();
  const format = useFormat();

  // ── URL state ──────────────────────────────────────────────────────────
  const urlSearch = searchParams.get('search') ?? '';
  const rawStock = searchParams.get('stock');
  const stock = isStockFilter(rawStock) ? rawStock : undefined;
  // #2356 — one read for the page. A failed read costs the notice, never the
  // list: the state is supplementary and losing a settings read must not cost
  // the operator their catalogue.
  const omsAttention = useOmsAttentionQuery();
  const availabilityUnknown = omsAttention.forReason('availability-unknown');

  // #3588 - margin reminders. Off means hidden, never degraded: cost snapshots
  // keep being written, only the views and nudges go quiet.
  const trackMargin = useTrackMargin();
  const costCoverage = useCostCoverageQuery({ enabled: trackMargin });

  const rawTaxRateState = searchParams.get('taxRateState');
  const taxRateState =
    rawTaxRateState === 'missing' || rawTaxRateState === 'not-checked' || rawTaxRateState === 'known'
      ? rawTaxRateState
      : undefined;
  const unlistedOnParam = searchParams.get('unlistedOn') ?? '';
  const unlistedOn = useMemo(
    () => (unlistedOnParam ? unlistedOnParam.split(',').filter(Boolean) : undefined),
    [unlistedOnParam],
  );
  const sourceConnectionId = searchParams.get('connectionId') ?? undefined;
  // #2447 — opt-in: hides only a product whose variants are ALL deleted at
  // the master (a "phantom" row, #1689). Default off so an install's
  // existing view is unchanged until the operator asks for it.
  const hideFullyStale = searchParams.get('hideStale') === '1';
  const rawSort = searchParams.get('sort');
  const sortField = isSortField(rawSort) ? rawSort : DEFAULT_SORT;
  const rawDir = searchParams.get('dir');
  const sortDir: ProductListSortDir = isSortDir(rawDir) ? rawDir : DEFAULT_DIR[sortField];
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);


  // Selection state is component-local. It is *not* mirrored into URL params
  // during selection (the URL would balloon on every checkbox toggle, and the
  // common bulk-listing pattern is "select → submit", not "share a selection
  // link"). On submit click, the variant IDs are serialised into the wizard
  // route so the destination has the full list.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The product the peek shows (#4027); local UI state like the selection.
  const [peekId, setPeekId] = useState<string | null>(null);
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
  // #2255 — the tax-rate tile only means anything where a shop can be asked for
  // a rate. With no ProductMaster connection, "312 products have no tax rate" is
  // a statement about an install that was never going to have one.
  const hasProductMaster = useMemo(
    () =>
      (connectionsQuery.data ?? []).some(
        (c) => c.status === 'active' && c.supportedCapabilities?.includes('ProductMaster'),
      ),
    [connectionsQuery.data],
  );

  // Unified publish targets (#1828): offer marketplaces (OfferCreator) OR
  // online shops (ProductPublisher), capability-driven. Drives the publish
  // CTAs + picker. The gaps KPI / "Unlisted on" chips / per-row gap detection
  // stay keyed to the marketplace `offerManagerConnections` subset above -
  // "gap" is a narrower, offer-specific concept. The coverage PILLS, however,
  // answer "is this published anywhere" and must include shop destinations
  // too (#1838 follow-up fix - a product published to a WooCommerce
  // connection previously rendered no pill at all).
  const publishDestinations = useMemo(
    () => selectPublishDestinations(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );
  const hasShopDestination = useMemo(
    () => publishDestinations.some((d) => d.kind === 'shop'),
    [publishDestinations],
  );
  // Coverage-pill connection set (#1838 follow-up fix): every active publish
  // destination (marketplace OR shop) - the same union `publishDestinations`
  // already resolves, since a connection carries at most one listing-mapping
  // kind (#1837) so it can never double-count here either.
  const coveragePillConnections = useMemo(
    () => publishDestinations.map((d) => d.connection),
    [publishDestinations],
  );

  // Source select lists ALL active connections (any capability); the cockpit
  // source axis is about provenance, not offer creation.
  const activeConnections = useMemo(
    () => (connectionsQuery.data ?? []).filter((c) => c.status === 'active'),
    [connectionsQuery.data],
  );
  // One batched read, indexed once — the Source column's `ConnectionCell` must
  // never cost a request per row (#1996). A whole `Connection` structurally
  // satisfies `ConnectionCellFacts` (`{ name, status }`), so this existing map
  // feeds the cell directly rather than growing a second, parallel index.
  const connectionById = useMemo(() => {
    const map = new Map<string, Connection>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [connectionsQuery.data]);

  // The origin chip's channel (#3670): the registry's short label for the face,
  // and the connection's environment so a sandbox source never reads the same
  // as its production twin. The platformType comes off the product's own
  // external-id row, so the chip renders even while the connection itself is
  // still unresolved.
  const originChipChannel = useCallback(
    (origin: { connectionId: string; platformType: string }): ConnectionChipChannel => ({
      platformType: origin.platformType,
      label: resolvePlatformLabel(platforms, origin.platformType),
      shortLabel: resolvePlatformShortLabel(platforms, origin.platformType),
      environment: readConnectionEnvironment(connectionById.get(origin.connectionId)?.config),
    }),
    [platforms, connectionById],
  );

  // ── Server queries ─────────────────────────────────────────────────────
  const filters: ProductFilters = {
    search: debouncedSearch || undefined,
    stock,
    taxRateState,
    unlistedOn,
    connectionId: sourceConnectionId,
    hideFullyStale: hideFullyStale || undefined,
  };
  const sort: ProductListSort = { field: sortField, dir: sortDir };
  const pagination = { limit: PAGE_SIZE, offset };

  // Two-stage read (#2947): the rows do not wait for a count that cannot stop
  // early under this list's name / SKU `ILIKE` search.
  const query = useProductRowsQuery(filters, pagination, sort);
  const totalStage = useProductsTotal(filters, query.data);
  const items = query.data?.items ?? [];

  // Fire once per successful list load, not on every filter/page refetch —
  // demo-mode analytics only (#1788), no-op elsewhere.
  const hasFiredViewedRef = useRef(false);
  useEffect(() => {
    // Waits for the TOTAL, not just the rows (#2947): the bucket describes the
    // whole result set, and bucketing a page size would silently redefine the
    // metric. A count that never resolves therefore fires no event, which is
    // the right trade - a wrong bucket is worse than a missing one.
    if (totalStage.total !== null && !hasFiredViewedRef.current) {
      hasFiredViewedRef.current = true;
      captureDemoEvent('demo_products_viewed', {
        resultCountBucket: bucketCount(totalStage.total),
      });
    }
  }, [totalStage.total]);

  // KPI tile counts - one count per filter set through `GET /products/count`
  // (#2947), never a `limit: 1` list read: the count is the expensive half and
  // the rows would be thrown away. The "All products" probe shares its cache
  // entry with the unfiltered results count above. The gaps probe is disabled
  // with zero OfferCreator connections (its filter would be meaningless).
  const gapsFilters = useMemo<ProductFilters>(
    () => ({ unlistedOn: offerCreatorIds }),
    [offerCreatorIds],
  );
  // #2255 - two tax-rate probes, because the two states drive different
  // remedies and must never be added together. `missing` is the tile;
  // `not-checked` is the sync suggestion, and it is the whole catalogue on
  // day one. "Hidden at source" = all products minus what `hideFullyStale` keeps.
  const kpiProbes = useMemo<ProductCountProbe[]>(
    () => [
      { filters: undefined },
      { filters: { taxRateState: 'missing' }, enabled: hasProductMaster },
      { filters: { taxRateState: 'not-checked' }, enabled: hasProductMaster },
      { filters: { stock: 'out' } },
      { filters: { stock: 'low' } },
      { filters: { stock: 'oversold' } },
      { filters: { hideFullyStale: true } },
      { filters: gapsFilters, enabled: offerCreatorIds.length > 0 },
    ],
    [hasProductMaster, gapsFilters, offerCreatorIds.length],
  );
  const [allTotal, taxMissingCount, taxNotCheckedCount, outCount, lowCount, oversoldCount, keptTotal, gapsCount] =
    useProductCountProbes(kpiProbes);

  const sourceProbes = useMemo<ProductCountProbe[]>(
    () => activeConnections.map((c) => ({ filters: { connectionId: c.id } })),
    [activeConnections],
  );
  const sourceProbeCounts = useProductCountProbes(sourceProbes);
  const gapProbes = useMemo<ProductCountProbe[]>(
    () => offerManagerConnections.map((c) => ({ filters: { unlistedOn: [c.id] } })),
    [offerManagerConnections],
  );
  const gapProbeCounts = useProductCountProbes(gapProbes);
  const sourceCounts = useMemo(
    () => Object.fromEntries(activeConnections.map((c, i) => [c.id, sourceProbeCounts[i]])),
    [activeConnections, sourceProbeCounts],
  );
  const gapConnections = useMemo(
    () =>
      offerManagerConnections.map((c, i) => ({
        id: c.id,
        name: c.name,
        platform: resolvePlatformLabel(platforms, c),
        count: gapProbeCounts[i],
      })),
    [offerManagerConnections, gapProbeCounts, platforms],
  );
  const staleCount =
    allTotal !== undefined && keptTotal !== undefined ? Math.max(allTotal - keptTotal, 0) : undefined;
  const stockCounts = {
    all: allTotal,
    out: outCount,
    low: lowCount,
    oversold: oversoldCount,
  };

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

  /** Explicit sort write (the Sort menu and the header sort buttons). */
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
    debouncedSearch || stock || unlistedOnParam || sourceConnectionId || hideFullyStale || taxRateState,
  );

  /** Clears every filter; `keepStock` leaves the stock tab alone (the pills' Clear all). */
  const clearFilters = useCallback(
    (keepStock = false): void => {
      setSearchInput('');
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        if (!keepStock) next.delete('stock');
        next.delete('unlistedOn');
        next.delete('connectionId');
        next.delete('hideStale');
        next.delete('taxRateState');
        next.delete('offset');
        return next;
      });
    },
    [setSearchParams],
  );

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

  // Dispatch a resolved destination to the bulk wizard (#1829): both a
  // marketplace and a shop route into the same bulk-create wizard, which
  // branches its steps + submit by the destination's capability. Product
  // context is preserved end-to-end (no re-pick).
  const dispatchPublish = useCallback(
    (productIds: readonly string[], connectionId: string) => {
      const destination = publishDestinations.find((d) => d.connection.id === connectionId);
      if (!destination) return;
      goToWizard(productIds, connectionId);
    },
    [publishDestinations, goToWizard],
  );

  // Capability-aware bulk launch: 1 destination → dispatch straight;
  // 2+ → grouped destination picker. (0 hides the action.)
  const handleCreateOffers = useCallback(() => {
    captureDemoEvent('demo_offer_create_launched', { source: 'bulk_bar' });
    if (publishDestinations.length === 1) {
      dispatchPublish(Array.from(selectedIds), publishDestinations[0]!.connection.id);
    } else if (publishDestinations.length > 1) {
      setPendingProductId(null);
      setPickerOpen(true);
    }
  }, [publishDestinations, dispatchPublish, selectedIds]);

  // Per-row "+ Create offers" CTA — same launch, single product preselected.
  const handleCreateOffersForProduct = useCallback(
    (productId: string) => {
      captureDemoEvent('demo_offer_create_launched', { source: 'row' });
      if (publishDestinations.length === 1) {
        dispatchPublish([productId], publishDestinations[0]!.connection.id);
      } else if (publishDestinations.length > 1) {
        setPendingProductId(productId);
        setPickerOpen(true);
      }
    },
    [publishDestinations, dispatchPublish],
  );

  const soleConnectionName =
    publishDestinations.length === 1
      ? resolvePlatformLabel(platforms, publishDestinations[0]!.connection)
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
              ? interpolate(copy.row.unselect, { name: product.name })
              : disabled
                ? interpolate(copy.row.capReached, { max: format.number(BULK_SELECTION_CAP) })
                : interpolate(copy.row.select, { name: product.name })
          }
          tooltip={
            disabled
              ? interpolate(copy.row.capTooltip, { max: format.number(BULK_SELECTION_CAP) })
              : undefined
          }
        />
      );
    },
    [selectedIds, atCap, handleToggleRow, copy, format],
  );

  const renderStockCell = useCallback((product: Product): ReactNode => {
    // #3569 - available to promise leads when the list carries it. `null` is
    // "OpenLinker does not know", so it is never drawn as 0 or as Out of stock.
    if (product.availableToPromise !== undefined) {
      const atpStatus = deriveAtpStatus(product.availableToPromise);
      return (
        <span className="products-cell-stack" data-testid={`stock-list-cell-${product.sku ?? product.id}`}>
          {product.availableToPromise === null ? (
            <span className="av-unknown" title={copy.stock.notKnownTitle}>
              {copy.stock.notKnown}
            </span>
          ) : (
            <span>
              <span className="products-stock-value mono tabular">{product.availableToPromise}</span>{' '}
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                {copy.stock.toSell}
              </span>
            </span>
          )}
          {atpStatus === 'unknown' ? (
            <StatusBadge tone="neutral" withDot compact>
              {copy.stock.notKnown}
            </StatusBadge>
          ) : (
            <StatusBadge tone={STOCK_STATUS_BADGE_TONE[atpStatus]} withDot compact>
              {STOCK_STATUS_LABEL[atpStatus]}
            </StatusBadge>
          )}
          {product.totalAvailable !== undefined ? (
            <span className="text-muted products-cell-sub tabular">
              {interpolate(copy.stock.master, { n: format.number(product.totalAvailable) })}
            </span>
          ) : null}
        </span>
      );
    }
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
            {interpolate(copy.stock.reserved, { n: format.number(product.totalReserved ?? 0) })}
          </span>
        ) : null}
      </span>
    );
  }, [copy, format]);

  /** The product's stock state as one badge (the peek header). */
  const renderStockBadge = useCallback(
    (product: Product): ReactNode => {
      const n = product.availableToPromise !== undefined ? product.availableToPromise : product.totalAvailable;
      if (n === undefined) return null;
      if (n === null) {
        return (
          <StatusBadge tone="neutral" withDot compact>
            {copy.stock.notKnown}
          </StatusBadge>
        );
      }
      const status = deriveStockStatus(n);
      return (
        <StatusBadge tone={STOCK_STATUS_BADGE_TONE[status]} withDot compact>
          {STOCK_STATUS_LABEL[status]}
        </StatusBadge>
      );
    },
    [copy],
  );

  const renderCoveragePills = useCallback(
    (product: Product): ReactNode => (
      <ListingsCoveragePills
        coverage={product.listingsCoverage}
        variantCount={product.variantCount ?? 0}
        connections={coveragePillConnections}
      />
    ),
    [coveragePillConnections],
  );

  /**
   * #2447 — deleted-at-source flag, shared by the desktop row and the mobile
   * card meta. "some" (warning) vs "all" (error) so a partially-live
   * multi-variant product doesn't read as fully gone.
   */
  const renderStalenessBadge = useCallback((product: Product): ReactNode => {
    const staleness = deriveProductStaleness(product);
    if (!staleness) return null;
    return (
      <StatusBadge tone={staleness.tone} withDot compact>
        {staleness.label}
      </StatusBadge>
    );
  }, []);

  /** A header stack of per-label sort buttons; the active key is marked. */
  const renderSortStack = useCallback(
    (fields: readonly ProductListSortField[], align: 'left' | 'right' = 'left'): ReactElement => (
      <span className={align === 'right' ? 'sortstack' : 'sortstack sortstack--left'}>
        {fields.map((field) => (
          <button
            key={field}
            type="button"
            className={`sortbtn${sortField === field ? ' sortbtn--active' : ''}`}
            aria-pressed={sortField === field}
            onClick={() => {
              handleMergedSort(field);
            }}
          >
            {field === 'name' ? copy.columns.product : field === 'stock' ? copy.columns.stock : copy.sortOptions[field]}
            <span className="sortbtn__ind" aria-hidden="true">
              {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
            </span>
          </button>
        ))}
      </span>
    ),
    [sortField, sortDir, handleMergedSort, copy],
  );

  const columns: DataTableColumn<Product>[] = useMemo(
    () => [
      {
        id: 'select',
        width: '2.5rem',
        // Header rendered manually for indeterminate state.
        header: (
          <CheckboxCell
            state={headerCheckboxState}
            onToggle={handleToggleHeader}
            ariaLabel={
              headerCheckboxState === 'all' ? copy.columns.unselectAll : copy.columns.selectAll
            }
          />
        ),
        cell: (product) => renderSelectCheckbox(product),
        align: 'left',
      },
      {
        id: 'name',
        width: '31%',
        // #2538 - Thumbnail, name and a meta line.
        lines: 2,
        header: renderSortStack(PRODUCT_SORT_FIELDS),
        cell: (product): ReactNode => {
          const origin = product.externalIds?.[0];
          return (
            <span className="product-row">
              <ProductThumbnail src={product.images?.[0]} name={product.name} />
              <span className="products-cell-stack">
                <span className="ds-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Link
                    to={product.id}
                    className="product-row__name product-row__name--link"
                    data-testid={`stock-list-open-${product.sku ?? product.id}`}
                  >
                    {product.name}
                  </Link>
                  {(product.variantCount ?? 0) > 1 ? (
                    <StatusBadge tone="neutral" compact>
                      {plural(product.variantCount ?? 0, copy.row.variantsBadge)}
                    </StatusBadge>
                  ) : null}
                  {renderStalenessBadge(product)}
                </span>
                {/* Labelled, not a bare mono string (#2092): unlabelled, an
                    identifier under the product name reads as "some id" and the
                    operator has to know by convention that it is the SKU rather
                    than an EAN, an internal id or an external reference. The
                    label is body text, the value stays mono — and `.mono-text`
                    inside a table cell truncates at 20ch, which is why the
                    `title` sits on the VALUE and not on the wrapper (a wrapper
                    title would describe "SKU: …" and leave the truncated value
                    unreachable). No EAN line: it lives on the variant, so a
                    product row could only ever carry one when the product
                    resolves to a single variant. */}
                {product.sku ? (
                  <span className="text-muted products-cell-sub">
                    {renderRich(
                      copy.row.sku,
                      {
                        value: (text: string) => (
                          <span className="mono-text" title={text}>
                            {text}
                          </span>
                        ),
                      },
                      { sku: product.sku },
                    )}
                  </span>
                ) : null}
                {/* The Source column is `hideBelow: 1024`, so below that width the
                    product's origin would vanish. It folds here instead (#2094):
                    a product's source connection is this identity column's own
                    subject. `display: none` above the breakpoint means exactly one
                    of the two renderings is exposed at any width. */}
                {origin ? (
                  <ConnectionFold
                    connectionId={origin.connectionId}
                    connection={connectionById.get(origin.connectionId) ?? null}
                    loading={connectionsQuery.isLoading}
                    channel={originChipChannel(origin)}
                  />
                ) : null}
              </span>
            </span>
          );
        },
      },
      {
        id: 'source',
        width: '14%',
        // #2538 - ConnectionCell stacks the name over its status.
        lines: 2,
        header: copy.columns.source,
        // Stays 1024 (#1996): lowering it to 768 was rejected because it keeps
        // the column only behind horizontal scroll. The tablet relocation of
        // this fact into the Product cell shipped as #2094 (S8).
        hideBelow: 1024,
        cell: (product): ReactNode => {
          const origin = product.externalIds?.[0];
          if (!origin) return <span className="text-muted">-</span>;
          return (
            <ConnectionCell
              connectionId={origin.connectionId}
              // `.get()` returns undefined on a miss, which ConnectionCell reads
              // as "resolve it yourself" and would silently reinstate the
              // per-row fetch #1996 rejected — coalesce to null and hand it the
              // batched query's loading state instead, or a cold load renders a
              // column of "Unknown".
              connection={connectionById.get(origin.connectionId) ?? null}
              loading={connectionsQuery.isLoading}
              // One clickable chip (#3670): the platform at rest, the
              // connection name sliding out on hover.
              channel={originChipChannel(origin)}
            />
          );
        },
      },
      {
        id: 'stock',
        width: '14%',
        header: renderSortStack(STOCK_SORT_FIELDS),
        cell: (product) => renderStockCell(product),
      },
      {
        id: 'listings',
        width: '19%',
        header: copy.columns.listings,
        cell: (product) => (
          <span className="products-cell-stack">
            {renderCoveragePills(product)}
            {write.visible && (hasListingGap(product) || hasShopDestination) ? (
              <Button
                tone="ghost"
                className="button--sm products-row-cta"
                onClick={() => {
                  handleCreateOffersForProduct(product.id);
                }}
              >
                {copy.row.publish}
              </Button>
            ) : null}
          </span>
        ),
      },
      {
        id: 'money',
        width: '14%',
        header: renderSortStack(MONEY_SORT_FIELDS, 'right'),
        align: 'right',
        cell: (product) => (
          <span className="products-cell-stack products-cell-stack--end">
            <span className="mono tabular products-stock-value">
              {formatPrice(product.price, product.currency, copy.price.currencyUnknown, format)}
            </span>
            <span className="products-cell-sub products-cell-sub--date mono tabular">
              {copy.row.updatedPrefix} <TimeDisplay iso={product.updatedAt} format="date" />
            </span>
            <span className="products-cell-sub products-cell-sub--date mono tabular">
              <TimeDisplay iso={product.createdAt} format="date" />
            </span>
          </span>
        ),
        hideBelow: 480,
      },
      {
        id: 'peek',
        width: '3rem',
        // #4027 - the arrow says the row opens a panel from the right.
        header: <span className="sr-only">{copy.peek.details}</span>,
        cell: (product) => (
          <PeekArrow
            label={interpolate(copy.peek.detailsAria, { name: product.name })}
            onOpen={() => {
              setPeekId(product.id);
            }}
          />
        ),
      },
    ],
    [
      headerCheckboxState,
      handleToggleHeader,
      renderSelectCheckbox,
      renderStockCell,
      renderCoveragePills,
      renderStalenessBadge,
      connectionById,
      connectionsQuery.isLoading,
      originChipChannel,
      write.visible,
      hasListingGap,
      hasShopDestination,
      handleCreateOffersForProduct,
      copy,
      format,
      plural,
      renderSortStack,
    ],
  );


  // ── Peek (#4027) ───────────────────────────────────────────────────────
  const peekIndex = peekId ? items.findIndex((p) => p.id === peekId) : -1;
  const peekProduct = peekIndex >= 0 ? items[peekIndex] : undefined;
  const navigatePeek = useCallback(
    (step: -1 | 1): void => {
      const next = items[peekIndex + step];
      if (next) setPeekId(next.id);
    },
    [items, peekIndex],
  );
  const peekView: ProductPeekView | null = peekProduct
    ? {
        product: peekProduct,
        source: peekProduct.externalIds?.[0] ? (
          <ConnectionChip
            connectionId={peekProduct.externalIds[0].connectionId}
            name={connectionById.get(peekProduct.externalIds[0].connectionId)?.name ?? null}
            loading={connectionsQuery.isLoading}
            channel={originChipChannel(peekProduct.externalIds[0])}
          />
        ) : null,
        variants:
          (peekProduct.variantCount ?? 0) > 1 ? plural(peekProduct.variantCount ?? 0, copy.row.variantsBadge) : null,
        price: formatPrice(peekProduct.price, peekProduct.currency, copy.price.currencyUnknown, format),
        stockBadge: renderStockBadge(peekProduct),
        stock: renderStockCell(peekProduct),
        listings: renderCoveragePills(peekProduct),
        taxRate: (
          <>
            <ProductTaxRateBadge product={peekProduct} />
            {renderStalenessBadge(peekProduct)}
          </>
        ),
        onPublish:
          write.visible && (hasListingGap(peekProduct) || hasShopDestination)
            ? () => {
                handleCreateOffersForProduct(peekProduct.id);
              }
            : undefined,
        detail: (
          <ProductRowDetail
            product={peekProduct}
            connections={offerManagerConnections}
            canCreateOffers={write.visible}
            onCreateOffers={handleCreateOffersForProduct}
          />
        ),
      }
    : null;

  const resultCount =
    totalStage.total !== null
      ? { value: totalStage.total, atLeast: false }
      : query.data
        ? { value: offset + query.data.items.length, atLeast: true }
        : null;

  const stockTabs: StatusTab<ProductStockFilter>[] = [
    { key: null, label: copy.listFilters.allProducts, count: stockCounts.all },
    { key: 'out', label: copy.filters.stockChips.out, tone: 'error', count: stockCounts.out },
    { key: 'low', label: copy.filters.stockChips.low, tone: 'warning', count: stockCounts.low },
    { key: 'oversold', label: copy.filters.stockChips.oversold, tone: 'error', count: stockCounts.oversold },
  ];
  const costGap =
    !trackMargin || (costCoverage.data && costCoverage.data.soldVariantsWithoutCost <= 0)
      ? null
      : costCoverage.data
        ? {
            count: costCoverage.data.soldVariantsWithoutCost,
            days: costCoverage.data.days,
            netSales: costCoverage.data.netSalesWithoutCost,
            currency: costCoverage.data.currency,
          }
        : undefined;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={interpolate(copy.description, { max: format.number(BULK_SELECTION_CAP) })}
      actions={
        <Link
          className="button button--secondary"
          to="/products/cost-prices"
          data-testid="products-open-cost-prices"
        >
          {copy.costPrices}
        </Link>
      }
    >
      {/* #4027 - stock tabs and "Needs a look", the orders status bar. */}
      <div className="list-statusbar">
        <StatusTabs
          tabs={stockTabs}
          value={stock ?? null}
          onChange={(next) => {
            setFilterParam('stock', next ?? '');
          }}
          aria-label={copy.listFilters.statusTabsAria}
        />
        <ProductAttentionSummary
          allGapsValue={gapsCsv}
          gapsCount={gapsCount}
          gapConnections={gapConnections}
          unlistedOn={unlistedOnParam}
          onUnlistedOnChange={(next) => {
            setFilterParam('unlistedOn', next);
          }}
          showTax={hasProductMaster}
          taxMissingCount={taxMissingCount}
          taxNotCheckedCount={taxNotCheckedCount}
          taxRateState={taxRateState}
          onTaxRateStateChange={(next) => {
            setFilterParam('taxRateState', next ?? '');
          }}
          costGap={costGap}
        />
      </div>

      {/*
        #2356 — A1-U (`availability-unknown`) renders on PRODUCT rows per its
        descriptor's `surfaces`, but it is derived from `Connection.config`, so
        OpenLinker does not know WHICH products are affected. A per-row badge
        would therefore assert knowledge it does not have; a page-level notice
        states exactly what is true — publishing is paused, and the fix is on the
        connections it names.

        This is a stated deviation from the issue's "renders on its owning row",
        recorded here and in the PR body rather than left to look like an
        oversight. The title is produced by `attentionTitle`, so it is
        byte-identical to the one the `Needs attention` section renders.
      */}
      {availabilityUnknown.length > 0 ? (
        <Alert tone="error" title={attentionTitle('availability-unknown')}>
          {ATTENTION_REASON_COPY['availability-unknown'].body}{' '}
          {/*
            The reason's own `.action` sentence says "the connections named
            below" — true on the Needs attention section, which lists them, and
            false here, where nothing is named. Deliberately not reused: the
            link points at the surface that DOES name them instead.
          */}
          <Link to="/settings/who-decides">{copy.availabilityUnknownLink}</Link>
        </Alert>
      ) : null}

      <ProductsFilterBar
        searchInput={searchInput}
        onSearchChange={handleSearchChange}
        sources={activeConnections}
        sourceCounts={sourceCounts}
        sourceConnectionId={sourceConnectionId}
        onSourceChange={(id) => {
          setFilterParam('connectionId', id ?? '');
        }}
        allGapsValue={gapsCsv}
        gapsCount={gapsCount}
        gapConnections={gapConnections}
        unlistedOn={unlistedOnParam}
        onUnlistedOnChange={(next) => {
          setFilterParam('unlistedOn', next);
        }}
        showTax={hasProductMaster}
        taxRateState={taxRateState}
        taxMissingCount={taxMissingCount}
        taxNotCheckedCount={taxNotCheckedCount}
        onTaxRateStateChange={(next) => {
          setFilterParam('taxRateState', next ?? '');
        }}
        stock={stock}
        stockCounts={stockCounts}
        onStockChange={(next) => {
          setFilterParam('stock', next ?? '');
        }}
        hideStale={hideFullyStale}
        staleCount={staleCount}
        onHideStaleChange={(next) => {
          setFilterParam('hideStale', next ? '1' : '');
        }}
        resultCount={resultCount}
        sort={sortField}
        dir={sortDir}
        defaultDir={DEFAULT_DIR}
        onSortChange={setSort}
        onClearAll={() => {
          clearFilters(true);
        }}
      />

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label={copy.loading} />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(query.error, 'products')}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.error.retry}</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={
            anyFilterActive
              ? copy.empty.filtered
              : copy.empty.unsynced
          }
          action={
            anyFilterActive ? (
              <Button
                onClick={() => {
                  clearFilters();
                }}
              >
                {copy.filters.clear}
              </Button>
            ) : (
              <Link className="button button--primary" to="/connections">
                {copy.empty.manageConnections}
              </Link>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption={copy.tableCaption}
            className="products-table list-table--fixed list-table--peek"
            tableTestId="stock-list-table"
            rowAttributes={(product) => ({ 'data-testid': `stock-list-row-${product.sku ?? product.id}` })}
            columns={columns}
            rows={items}
            rowKey={(product) => product.id}
            stickyLeftColumns={2}
            stickyRightColumns={1}
            onRowClick={(product) => {
              setPeekId(product.id);
            }}
            rowClassName={(product) => (product.id === peekId ? 'list-row--peek' : undefined)}
            footer={
              <BulkActionBar
                count={selectedIds.size}
                selectedLabel={copy.bulk.selected}
                hint={
                  atCap
                    ? interpolate(copy.bulk.hintAtCap, { max: format.number(BULK_SELECTION_CAP) })
                    : interpolate(copy.bulk.hint, {
                        max: format.number(BULK_SELECTION_CAP),
                        remaining: format.number(BULK_SELECTION_CAP - selectedIds.size),
                      })
                }
                actions={
                  <>
                    <Button tone="ghost" className="button--sm" onClick={clearSelection}>
                      {copy.bulk.clear}
                    </Button>
                    {/* Capability-gated (#1096/#1828): hidden with 0 publish destinations. */}
                    {publishDestinations.length > 0 && write.visible ? (
                      <Button tone="primary" onClick={handleCreateOffers}>
                        {soleConnectionName
                          ? interpolate(copy.bulk.publishTo, {
                              destination: soleConnectionName,
                              n: format.number(selectedIds.size),
                            })
                          : interpolate(copy.bulk.publish, { n: format.number(selectedIds.size) })}
                      </Button>
                    ) : null}
                  </>
                }
              />
            }
            cardView={{
              // The same hooks the desktop table carries, so a stock check reads
              // a card exactly as it reads a row.
              listTestId: 'stock-list-cards',
              attributes: (product) => ({ 'data-testid': `stock-list-row-${product.sku ?? product.id}` }),
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
              // Same labelled form as the desktop sub-line, and nothing at all
              // when there is no SKU: an unlabelled identifier reads as "some
              // id" on a card exactly as it does in a row, and the AC's "never
              // `SKU: -`" is a statement about the fact, not about one surface.
              // Text-only by choice, not by necessity — this table sets no
              // `rowHref`, so `DataTableCard` does NOT wrap the card's title and
              // subtitle in a row link and hosting a cell here would be legal.
              // The card simply has no need of a second copy control.
              subtitle: (product) =>
                product.sku ? (
                  <>
                    {renderRich(
                      copy.row.sku,
                      { value: (text: string) => <span className="mono-text">{text}</span> },
                      { sku: product.sku },
                    )}
                  </>
                ) : null,
              meta: (product) => (
                <span className="data-table__badge-row">
                  {product.price !== null ? (
                    <span className="mono tabular">
                      {formatPrice(product.price, product.currency, copy.price.currencyUnknown, format)}
                    </span>
                  ) : null}
                  {product.availableToPromise !== undefined ? (
                    <StatusBadge
                      tone={
                        deriveAtpStatus(product.availableToPromise) === 'unknown'
                          ? 'neutral'
                          : STOCK_STATUS_BADGE_TONE[deriveStockStatus(product.availableToPromise as number)]
                      }
                      withDot
                      compact
                      data-testid={`stock-list-cell-${product.sku ?? product.id}`}
                    >
                      {product.availableToPromise === null
                        ? copy.stock.notKnown
                        : interpolate(copy.stock.toSellWithStatus, {
                            n: format.number(product.availableToPromise),
                            status: STOCK_STATUS_LABEL[deriveStockStatus(product.availableToPromise)],
                          })}
                    </StatusBadge>
                  ) : product.totalAvailable !== undefined ? (
                    <StatusBadge
                      tone={STOCK_STATUS_BADGE_TONE[deriveStockStatus(product.totalAvailable)]}
                      withDot
                      compact
                    >
                      {STOCK_STATUS_LABEL[deriveStockStatus(product.totalAvailable)]}
                    </StatusBadge>
                  ) : null}
                  {renderCoveragePills(product)}
                  {renderStalenessBadge(product)}
                </span>
              ),
            }}
          />

          <ProductPeek
            view={peekView}
            position={peekIndex + 1}
            count={items.length}
            onNavigate={navigatePeek}
            onOpenChange={(open) => {
              if (!open) setPeekId(null);
              else captureDemoEvent('demo_product_row_expanded', {});
            }}
          />

          <ListPagination
            offset={offset}
            limit={PAGE_SIZE}
            rowCount={query.data?.items.length ?? 0}
            total={totalStage.total}
            totalState={totalStage.state}
            showTotalLoader={totalStage.showLoader}
            onOffsetChange={setOffset}
          />

          <OfferProductPickerModal
            isOpen={pickerOpen}
            onClose={() => {
              setPickerOpen(false);
              setPendingProductId(null);
            }}
            initialProductIds={pendingProductId ? [pendingProductId] : Array.from(selectedIds)}
            initialProductMeta={
              pendingProductId
                ? items.filter((p) => p.id === pendingProductId)
                : items.filter((p) => selectedIds.has(p.id))
            }
          />
        </>
      )}
    </PageLayout>
  );
}
