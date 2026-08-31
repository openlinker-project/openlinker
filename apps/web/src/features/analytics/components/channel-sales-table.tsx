/**
 * By-channel sales table (#1990)
 *
 * `ChannelSalesAnalyticsDto` carries only `sourceConnectionId` — no display
 * name, platform type, or brand colour — so this component joins against
 * `useConnectionsQuery()` and renders identity through `ConnectionCell`
 * (batched-lookup connection column) with a `ConnectionDot` adornment for
 * the per-channel colour.
 *
 * Money column (#1987/#2049/ADR-040): there is exactly ONE system-wide
 * reporting currency — a channel's `netRevenue`/`netAverageOrderValue`/
 * `revenueShare` are always comparable when `currency` is non-null.
 * `Orders` stays on the same FX-stamped basis as `Net sales`/`AOV` so a
 * row's own figures always reconcile with each other and with the single
 * `Total · {currency}` row below.
 *
 * `Net sales`/`AOV`, not `GMV`/gross AOV (net-sales tax-rate epic): both
 * money columns here are VAT-exclusive — `netRevenue` (technically the
 * spec's NOV until returns are also modeled, but shown under the "Net
 * sales" label per the reference design mockup) and `netAverageOrderValue`
 * (`netRevenue` divided by the net-eligible order count, computed once in
 * `groupChannelTotalsByCurrency` for the Total row and per-channel by the
 * API). A prior revision showed gross `revenue`/`averageOrderValue`
 * alongside them; those columns are gone — the KPI strip above already
 * carries the GMV qualifier for the same range, so this table doesn't need
 * to repeat it, and a row's Net sales and AOV can never disagree with each
 * other about which basis they're on (the bug this fixed: AOV kept reading
 * gross while Net sales read net, so a channel with nothing net-eligible
 * showed "Net sales 0.00" next to a real, nonzero gross AOV). Neither
 * column falls back to unconverted evidence when `currency` is null (an
 * unconverted amount is a GROSS figure and would misrepresent itself as
 * net), so that channel's cells render a plain empty state instead — see
 * the KPI strip's own doc comment for the full nuance on that tradeoff.
 *
 * **No `Total · {currency} (unconverted)` row (#2098 follow-up review):**
 * unconverted native-currency evidence can share its currency string with the
 * real reporting-currency total (e.g. a domestic-currency channel simply
 * awaiting its first FX-stamp pass) — a second "Total · PLN" row computed
 * from unrelated fields (`unconvertedValue`/`unconvertedCount` vs
 * `revenue`/`orderCount`) reads as a contradiction, not two distinct facts.
 * `countUnconvertedOrders` reports the currency-agnostic total count as one
 * plain footnote sentence instead — see `groupChannelTotalsByCurrency`'s own
 * doc comment for the full rationale.
 *
 * Calls its own `useSalesAnalyticsQuery` rather than accepting a `query`
 * prop — a caller that renders both this table and `AnalyticsKpiStrip` for
 * the same range gets the network dedup for free from TanStack Query's
 * shared cache entry (identical `queryKey`), without either component
 * needing to know the other's data shape.
 *
 * `.excl-note` exclusion annotations (#2481, epic #2452 Phase 8): a row
 * whose channel has orders in an open Data Coverage category's affected set
 * (currency, or one of tax-a/b/c — never `product-matching`, which cannot
 * under-count a channel total by definition: a `source_deleted`/
 * `awaiting_mapping` order fails to resolve to *any* channel-scoped total
 * in the first place, so it was never counted anywhere to be silently
 * missing from) gets one `AnalyticsExclusionNote` per affected category.
 * The cross-reference is exact: each open category's *full* affected-order
 * list (not the Data Coverage aggregate's 10-id sample — `useCoverageCrossReferenceQuery`
 * drains every page via the same paginated endpoints Phase 7's detail
 * modals use) is grouped by `sourceConnectionId`, since that field is on
 * every affected-order row and matches this table's own row key exactly —
 * unlike a product, a channel has no ambiguity to approximate.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Chip } from '../../../shared/ui/chip';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Sparkline } from '../../../shared/ui/sparkline';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ConnectionCell, useConnectionsQuery, type Connection } from '../../connections';
import { ConnectionDot } from '../../orders';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import type { ChannelSalesAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { AnalyticsCoverage, AnalyticsCoverageFilters, CoverageCategory } from '../api/analytics-coverage.types';
import {
  countUnconvertedOrders,
  groupChannelTotalsByCurrency,
  revenueTrendValues,
  trendTone,
  type ChannelCurrencyTotal,
} from '../lib/sales-analytics-view-model';
import { AnalyticsExclusionNote } from './analytics-exclusion-note';

/** Tax categories, plus currency — the categories a channel total can be under-counted by. `product-matching` is deliberately excluded, see the file header. */
type CrossReferenceableCategory = Extract<CoverageCategory, 'currency' | 'tax-a' | 'tax-b' | 'tax-c'>;
const CROSS_REFERENCEABLE_CATEGORIES: readonly CrossReferenceableCategory[] = ['currency', 'tax-a', 'tax-b', 'tax-c'];
const CROSS_REF_PAGE_LIMIT = 100;

interface CoverageOrderLite {
  internalOrderId: string;
  sourceConnectionId: string;
}

/**
 * Pages through one category's *complete* affected-order list (never the
 * 10-id sample) for the current range, grouped by `sourceConnectionId`.
 * One `useQuery` per category — a fixed set (`CROSS_REFERENCEABLE_CATEGORIES`),
 * so the number of hook calls never varies with how many categories happen
 * to be open, and each drains its own pages inside one `queryFn` rather
 * than as separate `useQuery` calls per page (a per-page-load, non-hot-path
 * read — see the implementation plan's own risk note on this bound).
 */
function useCoverageCrossReferenceQuery(
  category: CrossReferenceableCategory,
  coverageFilters: AnalyticsCoverageFilters,
  enabled: boolean
): { data: CoverageOrderLite[] | undefined } {
  const apiClient = useApiClient();

  const { data } = useQuery({
    queryKey: ['analytics', 'coverage-cross-reference', category, coverageFilters],
    queryFn: async (): Promise<CoverageOrderLite[]> => {
      const all: CoverageOrderLite[] = [];
      let offset = 0;
      for (;;) {
        const page =
          category === 'currency'
            ? await apiClient.analytics.getCurrencyMismatchOrders({ ...coverageFilters, limit: CROSS_REF_PAGE_LIMIT, offset })
            : await apiClient.analytics.getTaxCoverageOrders({
                category,
                ...coverageFilters,
                limit: CROSS_REF_PAGE_LIMIT,
                offset,
              });
        all.push(...page.items);
        offset += page.items.length;
        if (page.items.length < CROSS_REF_PAGE_LIMIT || offset >= page.total) break;
      }
      return all;
    },
    enabled,
  });

  return { data };
}

/** `connectionId -> category -> this channel's own affected-order count for it`. */
type ChannelExclusionMap = Map<string, Map<CrossReferenceableCategory, number>>;

function buildChannelExclusionMap(
  ordersByCategory: Partial<Record<CrossReferenceableCategory, CoverageOrderLite[] | undefined>>
): ChannelExclusionMap {
  const map: ChannelExclusionMap = new Map();
  for (const category of CROSS_REFERENCEABLE_CATEGORIES) {
    for (const order of ordersByCategory[category] ?? []) {
      const byCategory = map.get(order.sourceConnectionId) ?? new Map<CrossReferenceableCategory, number>();
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
      map.set(order.sourceConnectionId, byCategory);
    }
  }
  return map;
}

const PERCENT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

type ChannelRow =
  | { kind: 'channel'; channel: ChannelSalesAnalytics; connection: Connection | undefined }
  | { kind: 'total'; total: ChannelCurrencyTotal };

type ChannelDataRow = Extract<ChannelRow, { kind: 'channel' }>;

function ChannelIdentity({
  connectionsLoading,
  row,
}: {
  connectionsLoading: boolean;
  row: ChannelDataRow;
}): ReactElement {
  return (
    <ConnectionCell
      connectionId={row.channel.sourceConnectionId}
      connection={row.connection ?? null}
      loading={connectionsLoading}
      adornment={
        <ConnectionDot name={row.connection?.name ?? null} platformType={row.connection?.platformType} />
      }
    />
  );
}

function ChannelFlags({ row }: { row: ChannelDataRow }): ReactElement | null {
  const flags: ReactElement[] = [];
  if (!row.channel.coverageComplete) {
    flags.push(
      <Chip
        key="coverage"
        tone="info"
        title="This channel's earliest ingested order postdates the start of the selected range — its figures cover less than the full period."
      >
        Partial history
      </Chip>
    );
  }
  if (row.channel.unconvertedCount > 0) {
    flags.push(
      <Chip
        key="unconverted"
        tone="info"
        title={`${row.channel.unconvertedCount} order(s) in this channel have no reporting-currency FX stamp yet and are excluded from Net sales/Orders/AOV here.`}
      >
        Awaiting FX stamp
      </Chip>
    );
  }
  if (flags.length === 0) return null;
  return <>{flags}</>;
}

function ChannelExclusionNotes({
  row,
  exclusions,
  onOpenCategory,
}: {
  row: ChannelDataRow;
  exclusions: ChannelExclusionMap;
  onOpenCategory?: (category: CoverageCategory) => void;
}): ReactElement | null {
  if (!onOpenCategory) return null;
  const byCategory = exclusions.get(row.channel.sourceConnectionId);
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

function ChannelName({
  connectionsLoading,
  row,
  exclusions,
  onOpenCategory,
}: {
  connectionsLoading: boolean;
  row: ChannelDataRow;
  exclusions: ChannelExclusionMap;
  onOpenCategory?: (category: CoverageCategory) => void;
}): ReactElement {
  return (
    <span className="data-table__stack">
      <ChannelIdentity connectionsLoading={connectionsLoading} row={row} />
      <span>
        <ChannelFlags row={row} />
        <ChannelExclusionNotes row={row} exclusions={exclusions} onOpenCategory={onOpenCategory} />
      </span>
    </span>
  );
}

interface ChannelSalesTableProps {
  filters: SalesAnalyticsFilters;
  /**
   * The Data Coverage aggregate (#2474 Phase 7) — same query key
   * `AnalyticsDataCoveragePanel` fetches, no extra request. `undefined`
   * (still loading, or the caller never wired coverage in) renders every
   * row exactly as before Phase 8 — no exclusion notes.
   */
  coverage?: AnalyticsCoverage;
  /** ISO-instant range for the cross-reference reads — distinct shape from `filters` (#2474's DTOs, not the sales-analytics one). Required together with `coverage`/`onOpenCategory`. */
  coverageFilters?: AnalyticsCoverageFilters;
  /** Opens the matching Data Coverage detail modal — omit to keep every row's notes absent. */
  onOpenCategory?: (category: CoverageCategory) => void;
}

export function ChannelSalesTable({
  filters,
  coverage,
  coverageFilters,
  onOpenCategory,
}: ChannelSalesTableProps): ReactElement {
  const query = useSalesAnalyticsQuery(filters);
  const connectionsQuery = useConnectionsQuery();
  const pctFormat = useNumberFormat(PERCENT_FORMAT_OPTIONS);
  const intFormat = useNumberFormat();

  // Fixed set of hooks, one per cross-referenceable category (never a
  // variable count derived from which categories happen to be open — see
  // `useCoverageCrossReferenceQuery`'s own doc comment on why). Each is
  // `enabled` only when its own category is genuinely open.
  const openCategoryCodes = new Set(
    (coverage?.categories ?? []).filter((row) => row.affectedCount > 0).map((row) => row.category)
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
  const exclusions = buildChannelExclusionMap({
    currency: currencyOrders.data,
    'tax-a': taxAOrders.data,
    'tax-b': taxBOrders.data,
    'tax-c': taxCOrders.data,
  });

  if (query.isLoading) {
    return (
      <LoadingState
        eyebrow="Loading"
        title="Loading by-channel figures"
        message="Fetching revenue, orders and units per connected channel…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load by-channel figures"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const channels = query.data?.channels ?? [];
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c]));
  const channelRows: ChannelRow[] = channels.map((channel) => ({
    kind: 'channel',
    channel,
    connection: connectionsById.get(channel.sourceConnectionId),
  }));
  const totalRows: ChannelRow[] = groupChannelTotalsByCurrency(channels).map((total) => ({
    kind: 'total',
    total,
  }));
  const rows: ChannelRow[] = [...channelRows, ...totalRows];

  function renderAovCell(row: ChannelRow): ReactElement {
    if (row.kind === 'total') {
      return <>{formatAmount(row.total.netAverageOrderValue, row.total.currency)}</>;
    }
    if (row.channel.currency !== null) {
      return <>{formatAmount(row.channel.netAverageOrderValue, row.channel.currency)}</>;
    }
    // No unconverted-evidence fallback, same reasoning as Net sales: an
    // unconverted amount is a GROSS figure and would misrepresent itself as
    // a net average.
    return <EmptyValue label="No AOV figure can be given for this channel in range" />;
  }

  function renderNovCell(row: ChannelRow): ReactElement {
    if (row.kind === 'total') {
      return <strong>{formatAmount(row.total.netRevenue, row.total.currency)}</strong>;
    }
    if (row.channel.currency !== null) {
      return <>{formatAmount(row.channel.netRevenue, row.channel.currency)}</>;
    }
    return <EmptyValue label="No Net sales figure can be given for this channel in range" />;
  }

  const columns: DataTableColumn<ChannelRow>[] = [
    {
      id: 'channel',
      header: 'Channel',
      cell: (row) =>
        row.kind === 'total' ? (
          <strong>Total · {row.total.currency}</strong>
        ) : (
          <ChannelName
            connectionsLoading={connectionsQuery.isLoading}
            row={row}
            exclusions={exclusions}
            onOpenCategory={onOpenCategory}
          />
        ),
    },
    {
      id: 'nov',
      header: 'Net sales',
      align: 'right',
      cell: renderNovCell,
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      cell: (row) => intFormat.format(row.kind === 'total' ? row.total.orderCount : row.channel.orderCount),
      hideBelow: 480,
    },
    {
      id: 'aov',
      header: 'AOV',
      align: 'right',
      cell: renderAovCell,
      hideBelow: 768,
    },
    {
      id: 'units',
      header: 'Units',
      align: 'right',
      cell: (row) => intFormat.format(row.kind === 'total' ? row.total.unitsSold : row.channel.unitsSold),
      hideBelow: 1024,
    },
    {
      id: 'share',
      header: 'Share',
      align: 'right',
      cell: (row) => pctFormat.format(row.kind === 'total' ? row.total.revenueShare : row.channel.revenueShare),
      hideBelow: 768,
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (row) => {
        if (row.kind === 'total') return null;
        const values = revenueTrendValues(row.channel.trend);
        return values.length >= 2 ? (
          <Sparkline values={values} tone={trendTone(values)} width={72} height={20} ariaLabel="Channel revenue trend" />
        ) : (
          <EmptyValue label="Not enough data for a trend" />
        );
      },
      hideBelow: 1024,
    },
  ];

  const unconvertedCount = countUnconvertedOrders(channels);

  return (
    <>
      <DataTable
        caption="Sales by channel"
        rows={rows}
        columns={columns}
        rowKey={(row) => (row.kind === 'total' ? `total:${row.total.currency}` : row.channel.sourceConnectionId)}
        emptyState={<EmptyValue label="No channel has any orders in this range" />}
      />
      {unconvertedCount > 0 ? (
        <p className="data-table__footnote">
          {unconvertedCount} {unconvertedCount === 1 ? 'order' : 'orders'} not yet converted to the reporting
          currency — excluded from the figures above.
        </p>
      ) : null}
    </>
  );
}
