/**
 * Top products table (#1991)
 *
 * One row per product, one column per connected sales channel — the
 * flagship cross-channel view (see the #1991 implementation plan). Ranks by
 * net sales or units via a `SegmentedControl`; both figures stay visible in
 * both states, because an operator comparing "sells most money" against
 * "sells most items" needs the pair, not one swapped for the other. The
 * sort choice is local UI state (not URL state) — a per-section toggle
 * isn't, by itself, worth a shareable search param (see the plan's own
 * judgment-call note).
 *
 * Product/variant identity, never SKU: `TopProductRow.productId` is the
 * cross-channel join key (#1988 already groups by `productId`) — Allegro
 * sets `sku = offer.id`, so a SKU-keyed roll-up would split one product
 * across channels.
 *
 * "Not listed" vs. a real `0` (#1991 AC — must not render identically):
 * `EmptyValue` ("—") is wrong here because this cell knows *why* it is
 * empty. Absence from `row.channels` is ambiguous by itself — it means "no
 * sale in this date range", which covers both a channel that genuinely has
 * no listing AND a channel that is listed but simply sold nothing in the
 * window — so it is `isMissingFrom` (`missingFromConnectionIds`, independent
 * of the date range) that decides the rendering, not the absence alone: a
 * listed-but-quiet channel renders the same real, full-weight, tabular `0`
 * a channel with actual sales would, and only a genuinely unlisted channel
 * renders muted "Not listed" prose with a "Publish" action sharing the same
 * slot, swapping in via CSS on hover/focus — see `.cell-not-listed` in
 * `index.css`. The action must stay `position: absolute; right: 0` inside
 * the slot, never a flex sibling (an `opacity: 0` sibling still occupies
 * layout and misaligns the label from the column's right edge). On a
 * touch pointer (no hover) the slot instead stacks label + action
 * permanently visible — see the `@media (hover: none)` block, so #1991's
 * label-vs-action distinction is not desktop-only. The action itself is
 * gated behind `listings:write` (`useWriteAccess` + `ReadOnlyLock`) since
 * publishing is a real write, and is a genuine `<Link>`-as-button (styled
 * with the `chip chip--warning` classes, not the `Chip` component itself —
 * `Chip` hard-codes a filter-toggle `aria-pressed`, which is wrong for a
 * one-shot navigation) so it carries link semantics (middle-click,
 * open-in-new-tab) for free, in the warning-toned pill from the reference
 * design.
 *
 * Money column terminology (net-sales tax-rate epic): the single money
 * column here renders `row.netRevenue` — the VAT-exclusive figure,
 * technically the spec's NOV until returns are also modeled, but labeled
 * "Net sales" per the reference design mockup and per the KPI strip's /
 * by-channel table's identical naming decision (the returns nuance lives in
 * a tooltip, not repeated as a header here). Unlike the by-channel table
 * (#1990), which renders GMV and Net sales as two separate columns, this
 * table shows only Net sales — a deliberate choice to keep the flagship
 * cross-channel view from doubling its money columns on top of the
 * per-channel unit columns it already has.
 *
 * Net sales cell fallback: `netRevenue` shares the same `isStamped`
 * precondition as gross revenue (net and gross must be comparable, same
 * currency era — see the net-sales-tax-rate plan § Phase 2/3), so a product
 * with `currency: null` has no net figure either. Unlike the gross column
 * this table used to render, there is no `unconvertedNetRevenue` to fall
 * back to — an unconverted amount is a GROSS figure and would misrepresent
 * itself as net — so the cell renders a plain `EmptyValue` instead,
 * mirroring `ChannelSalesTable`'s `renderNovCell`.
 *
 * Thumbnails come from the product catalogue (`Product.images[0]`), joined
 * FE-side via `useProductsBatchQuery` — never from a per-channel order-item
 * image field, which is only populated by some source adapters and would
 * make the column patchy depending on which channel a sale landed on.
 *
 * `coverageGapAvailable` (#2172 review, IMPORTANT 1): `false` means the
 * coverage-gap enrichment failed for this whole response, so every row's
 * `missingFromConnectionIds` is an unreliable `[]` — indistinguishable from
 * "listed everywhere" — rather than a real answer. `ChannelCell` therefore
 * renders the real `0` unconditionally when this is `false`, never "Not
 * listed"/Publish, and the table carries a footnote saying so. Reusing the
 * `.data-table__footnote` convention from `ChannelSalesTable` (#2098
 * follow-up) rather than inventing a new pattern.
 *
 * `unresolvedProductCount` (#2172 review, IMPORTANT 2) is surfaced the same
 * way — a plain footnote line, not folded into the coverage-gap message,
 * since the two are independent facts (a product can fail to resolve to a
 * catalogue entry regardless of whether the coverage-gap enrichment ran).
 *
 * `.excl-note` exclusion annotations (#2799, mirroring `ChannelSalesTable`'s
 * #2481 Phase 8 wiring at the channel grain): a row whose product has
 * orders in an open Data Coverage category's affected set (currency, or one
 * of tax-a/b/c — never `product-matching`, which cannot resolve to any
 * product by construction, see `product-exclusion-map.lib.ts`'s doc
 * comment) gets one `AnalyticsExclusionNote` per affected category. The
 * cross-reference is exact, not approximated: each open category's *full*
 * affected-order list is grouped by `productId` (`buildProductExclusionMap`)
 * — a currency row's single representative `productId`, or every distinct
 * `productId` across a tax row's per-line `lineRates` — never a
 * channel-wide flag standing in for product-level granularity.
 *
 * @module features/analytics/components
 */
import { type ReactElement, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useConnectionsQuery, type Connection } from '../../connections';
import { useProductsBatchQuery, type Product } from '../../products';
import { useDemoMode } from '../../system';
import { useTopProductsQuery } from '../hooks/use-top-products-query';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import { useCoverageCrossReferenceQuery } from '../hooks/use-coverage-cross-reference-query';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { AnalyticsCoverage, AnalyticsCoverageFilters, CoverageCategory } from '../api/analytics-coverage.types';
import type { TopProductRow, TopProductsSortBy } from '../api/top-products.types';
import { channelCellFor, deriveChannelColumns, isMissingFrom } from '../lib/top-products-view-model';
import {
  createReportingCurrencyConverter,
  isCurrencyRecalculating,
  resolveReportingCurrencyRate,
} from '../lib/display-currency.lib';
import type { ReportingCurrencyConverter } from '../lib/display-currency.lib';
import {
  buildProductExclusionMap,
  CROSS_REFERENCEABLE_CATEGORIES,
  type ProductExclusionMap,
} from '../lib/product-exclusion-map.lib';
import { AnalyticsExclusionNote } from './analytics-exclusion-note';
import { RecalculatingValue } from './recalculating-value';

const DEFAULT_LIMIT = 20;

/**
 * `GET /analytics/top-products` has no `displayCurrency`/`rateBasis` axis of
 * its own (confirmed: no query param, no response field, no per-bucket
 * `appliedRate`) — a genuine backend gap that #2778/#2779 did not close for
 * this endpoint specifically. What DID change: `row.currency` is the same
 * system-wide reporting currency `headline.currency` is (ADR-040 — exactly
 * ONE reporting currency at any time), so the ONE real rate the backend
 * already resolved for the sales-analytics headline bucket
 * (`resolveReportingCurrencyRate`, reused verbatim from `ChannelSalesTable`)
 * is the correct rate here too — this is not a client-side derivation from
 * two unrelated totals (the earlier REJECTED `convertedRevenue / revenue`
 * shortcut that produced a live wrong number, 29 000 PLN read as ~20 000
 * "EUR" — see `display-currency.lib.ts`'s "REJECTED APPROACH" note), it is
 * the same audited rate reused for a second same-currency figure.
 * `useSalesAnalyticsQuery(filters)` below reads the byte-identical cache
 * entry `AnalyticsKpiStrip`/`ChannelSalesTable` already populate — no extra
 * request.
 *
 * `currencyRecalculating`: same in-flight-run signal `AnalyticsKpiStrip` and
 * `ChannelSalesTable` read from Data Coverage (`isCurrencyRecalculating`) —
 * without it, every row here reads a bare 0.00 for the whole duration of a
 * recalculation run.
 */
function renderNovCell(
  row: TopProductRow,
  currencyRecalculating: boolean,
  reportingConverter: ReportingCurrencyConverter
): ReactElement {
  if (currencyRecalculating) {
    return <RecalculatingValue />;
  }
  if (row.currency) {
    return (
      <>
        {formatAmount(
          reportingConverter.convertToDisplay(row.netRevenue, row.currency),
          reportingConverter.displayCurrencyFor(row.currency)
        )}
      </>
    );
  }
  return <EmptyValue label="No Net sales figure for this product in range" />;
}

const SORT_OPTIONS = [
  { value: 'revenue' as const, label: 'By net sales' },
  { value: 'units' as const, label: 'By units' },
];

interface ProductSalesTableProps {
  filters: SalesAnalyticsFilters;
  /** Same Data Coverage aggregate `AnalyticsKpiStrip`/`ChannelSalesTable` read — no extra request when the page fetches it once. `undefined` renders as if nothing is recalculating. */
  coverage?: AnalyticsCoverage;
  /** ISO-instant range for the cross-reference reads — same shape `ChannelSalesTable` takes. Required together with `coverage`/`onOpenCategory` to render exclusion notes. */
  coverageFilters?: AnalyticsCoverageFilters;
  /** Opens the matching Data Coverage detail modal — omit to keep every row's notes absent. */
  onOpenCategory?: (category: CoverageCategory) => void;
}

function buildPublishHref(productId: string, connectionId: string): string {
  const params = new URLSearchParams({ productIds: productId, connectionId });
  return `/listings/bulk-create/wizard?${params.toString()}`;
}

function ProductExclusionNotes({
  row,
  exclusions,
  onOpenCategory,
}: {
  row: TopProductRow;
  exclusions: ProductExclusionMap;
  onOpenCategory?: (category: CoverageCategory) => void;
}): ReactElement | null {
  if (!onOpenCategory) return null;
  const byCategory = exclusions.get(row.productId);
  if (!byCategory || byCategory.size === 0) return null;
  return (
    <>
      {CROSS_REFERENCEABLE_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => (
        <AnalyticsExclusionNote
          key={category}
          category={category}
          affectedCount={byCategory.get(category) ?? 0}
          onOpenCategory={onOpenCategory}
        />
      ))}
    </>
  );
}

function ProductCell({
  row,
  product,
  exclusions,
  onOpenCategory,
}: {
  row: TopProductRow;
  product: Product | undefined;
  exclusions: ProductExclusionMap;
  onOpenCategory?: (category: CoverageCategory) => void;
}): ReactElement {
  return (
    <span className="product-row">
      <ProductThumbnail src={product?.images?.[0]} name={row.name ?? row.productId} />
      <span className="data-table__stack">
        <span>{row.name ?? row.productId}</span>
        <ProductExclusionNotes row={row} exclusions={exclusions} onOpenCategory={onOpenCategory} />
      </span>
    </span>
  );
}

function PublishAction({
  row,
  connectionId,
  demoMode,
}: {
  row: TopProductRow;
  connectionId: string;
  demoMode: boolean;
}): ReactElement | null {
  // A one-shot navigation, not a filter toggle — a real link (styled as a
  // button) rather than `Chip` (which hard-codes `aria-pressed`, exposing a
  // permanently-"not pressed" toggle to AT) or a `Button` + `navigate()`
  // (which loses middle-click / open-in-new-tab for free). This cell is
  // never inside the row's own `rowHref` anchor (`linkifyFirstCell` only
  // covers the first column), so nesting is not a concern.
  const write = useWriteAccess('listings:write', demoMode);
  if (!write.visible) {
    return null;
  }

  const label = `Publish ${row.name ?? row.productId} on this channel — it already sells elsewhere`;

  if (write.demoReadOnly) {
    return (
      <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <button
          type="button"
          className="chip chip--warning cell-not-listed__chip"
          disabled
          aria-label={label}
        >
          Publish
        </button>
      </ReadOnlyLock>
    );
  }

  return (
    <Link
      to={buildPublishHref(row.productId, connectionId)}
      className="chip chip--warning cell-not-listed__chip"
      aria-label={label}
    >
      Publish
    </Link>
  );
}

function ChannelCell({
  row,
  connectionId,
  intFormat,
  demoMode,
  coverageGapAvailable,
}: {
  row: TopProductRow;
  connectionId: string;
  intFormat: Intl.NumberFormat;
  demoMode: boolean;
  coverageGapAvailable: boolean;
}): ReactElement {
  const channel = channelCellFor(row, connectionId);
  if (channel) {
    return <>{intFormat.format(channel.units)}</>;
  }

  // No sale in range on this channel — but that's not the same as never
  // listed there. Only `missingFromConnectionIds` (independent of the date
  // range) means "not listed"; anything else is a listed channel that
  // simply sold nothing in this window, and renders the same real,
  // full-weight `0` a genuine zero-unit channel would.
  //
  // `!coverageGapAvailable` short-circuits to the same real `0` even when
  // `isMissingFrom` would say otherwise — when the enrichment failed,
  // `missingFromConnectionIds` is an unreliable `[]` on EVERY row, not
  // evidence of being listed everywhere, so trusting it would render "Not
  // listed" as a false claim (#2172 review, IMPORTANT 1).
  if (!coverageGapAvailable || !isMissingFrom(row, connectionId)) {
    return <>{intFormat.format(0)}</>;
  }

  return (
    <span className="cell-not-listed">
      <span className="cell-not-listed__label">Not listed</span>
      <PublishAction row={row} connectionId={connectionId} demoMode={demoMode} />
    </span>
  );
}

export function ProductSalesTable({
  filters,
  coverage,
  coverageFilters,
  onOpenCategory,
}: ProductSalesTableProps): ReactElement {
  const currencyRecalculating = isCurrencyRecalculating(coverage);
  const [sortBy, setSortBy] = useState<TopProductsSortBy>('revenue');
  const query = useTopProductsQuery({ ...filters, sortBy, limit: DEFAULT_LIMIT, offset: 0 });
  const connectionsQuery = useConnectionsQuery();
  const intFormat = useNumberFormat();
  const demoMode = useDemoMode();

  // Shares the exact cache entry AnalyticsKpiStrip/ChannelSalesTable read
  // for the same `filters` — no second network request.
  const salesQuery = useSalesAnalyticsQuery(filters);
  const headline = salesQuery.data?.headline;
  const gmvConversion = headline?.displayCurrencyConversion;
  const reportingRate = resolveReportingCurrencyRate(gmvConversion, headline?.currency ?? null);
  // While the shared sales-analytics cache entry is still in flight, hold
  // every row native rather than rendering it native and then flipping to
  // the display currency once `salesQuery` resolves (PR #2788 review).
  const reportingConverter = createReportingCurrencyConverter(
    salesQuery.isLoading ? null : reportingRate,
    headline?.currency ?? null
  );

  // Fixed set of hooks, one per cross-referenceable category — see
  // `ChannelSalesTable`'s identical pattern and `useCoverageCrossReferenceQuery`'s
  // own doc comment on why the hook count must never vary across renders.
  const openCategoryCodes = useMemo(
    () => new Set((coverage?.categories ?? []).filter((row) => row.affectedCount > 0).map((row) => row.category)),
    [coverage]
  );
  const crossRefFilters: AnalyticsCoverageFilters = coverageFilters ?? { from: '', to: '' };
  const crossRefEnabled = Boolean(coverageFilters) && Boolean(onOpenCategory);
  const currencyOrders = useCoverageCrossReferenceQuery(
    'currency',
    crossRefFilters,
    crossRefEnabled && openCategoryCodes.has('currency')
  );
  const taxAOrders = useCoverageCrossReferenceQuery(
    'tax-a',
    crossRefFilters,
    crossRefEnabled && openCategoryCodes.has('tax-a')
  );
  const taxBOrders = useCoverageCrossReferenceQuery(
    'tax-b',
    crossRefFilters,
    crossRefEnabled && openCategoryCodes.has('tax-b')
  );
  const taxCOrders = useCoverageCrossReferenceQuery(
    'tax-c',
    crossRefFilters,
    crossRefEnabled && openCategoryCodes.has('tax-c')
  );
  const productExclusions = buildProductExclusionMap({
    currency: currencyOrders.data,
    'tax-a': taxAOrders.data,
    'tax-b': taxBOrders.data,
    'tax-c': taxCOrders.data,
  });

  const items = query.data?.items ?? [];
  const productIds = items.map((item) => item.productId);
  const productQueries = useProductsBatchQuery(productIds, { enabled: productIds.length > 0 });
  const productsById = new Map(
    productIds.map((id, index) => [id, productQueries[index]?.data])
  );
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c: Connection) => [c.id, c]));

  if (query.isLoading) {
    return (
      <LoadingState
        eyebrow="Loading"
        title="Loading top products"
        message="Fetching net sales and units per product, split by channel…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load top products"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const channelColumns = deriveChannelColumns(items);
  const coverageGapAvailable = query.data?.coverageGapAvailable ?? true;
  const unresolvedProductCount = query.data?.unresolvedProductCount ?? 0;

  const columns: DataTableColumn<TopProductRow>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (row) => (
        <ProductCell
          row={row}
          product={productsById.get(row.productId)}
          exclusions={productExclusions}
          onOpenCategory={onOpenCategory}
        />
      ),
    },
    {
      id: 'sku',
      header: 'SKU',
      hideBelow: 768,
      cell: (row) => (row.sku ? <span className="mono-text">{row.sku}</span> : <EmptyValue label="No SKU" />),
    },
    {
      id: 'revenue',
      header: sortBy === 'revenue' ? 'Net sales ↓' : 'Net sales',
      align: 'right',
      cell: (row) => renderNovCell(row, currencyRecalculating, reportingConverter),
    },
    {
      id: 'units',
      header: sortBy === 'units' ? 'Units ↓' : 'Units',
      align: 'right',
      // The server-ranked figure, not a re-sum of `row.channels[]` — that
      // breakdown is a separate read (#2172) and could in principle be
      // narrower than the full split, which would make the displayed total
      // silently disagree with the sort order the header arrow claims.
      cell: (row) => intFormat.format(row.units),
    },
    ...channelColumns.map(
      (connectionId): DataTableColumn<TopProductRow> => ({
        id: `channel-${connectionId}`,
        header: connectionsById.get(connectionId)?.name ?? connectionId,
        align: 'right',
        cell: (row) => (
          <ChannelCell
            row={row}
            connectionId={connectionId}
            intFormat={intFormat}
            demoMode={demoMode}
            coverageGapAvailable={coverageGapAvailable}
          />
        ),
      })
    ),
  ];

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <h3 className="section-title">Top products</h3>
        <SegmentedControl
          options={SORT_OPTIONS}
          value={sortBy}
          onChange={setSortBy}
          aria-label="Rank products by"
        />
      </div>
      <DataTable
        caption="Top products with per-channel split"
        rows={items}
        columns={columns}
        rowKey={(row) => row.productId}
        rowHref={(row) => `/products/${row.productId}`}
        stickyLeftColumns={1}
        cardView={{
          title: (row) => row.name ?? row.productId,
          subtitle: (row) => row.sku ?? undefined,
          summary: (row) => (
            <>
              {renderNovCell(row, currencyRecalculating, reportingConverter)}
              {' · '}
              {intFormat.format(row.units)} units
            </>
          ),
          detail: (row) => (
            <div className="data-table__stack">
              {channelColumns.map((connectionId) => (
                <span key={connectionId}>
                  {connectionsById.get(connectionId)?.name ?? connectionId}:{' '}
                  <ChannelCell
                    row={row}
                    connectionId={connectionId}
                    intFormat={intFormat}
                    demoMode={demoMode}
                    coverageGapAvailable={coverageGapAvailable}
                  />
                </span>
              ))}
            </div>
          ),
          collapsibleDetail: true,
        }}
        emptyState={<EmptyValue label="No orders in this range" />}
      />
      {!coverageGapAvailable ? (
        <p className="data-table__footnote">
          Listing-coverage check unavailable — channel columns show sales only, never "Not
          listed".
        </p>
      ) : null}
      {unresolvedProductCount > 0 ? (
        <p className="data-table__footnote">
          {unresolvedProductCount} product{unresolvedProductCount === 1 ? '' : 's'} on this page
          could not be resolved to a catalogue entry.
        </p>
      ) : null}
    </article>
  );
}
