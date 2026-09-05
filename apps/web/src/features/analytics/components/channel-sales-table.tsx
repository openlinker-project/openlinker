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
 * `Net sales`/`AOV` OR `GMV`/`AOV`, driven by the `netGrossBasis` prop
 * (net-sales tax-rate epic, basis-wired by #2903): both money columns
 * always read the SAME basis together — `net` (the default, and this
 * table's ONLY rendering before #2903) shows `netRevenue`/
 * `netAverageOrderValue` (technically the spec's NOV until returns are also
 * modeled, but shown under the "Net sales" label per the reference design
 * mockup); `gross` shows `revenue`/`averageOrderValue`, labeled "GMV"/"AOV".
 * A prior revision showed gross and net revenue in separate columns at the
 * same time; that design is gone — the bug it caused was AOV reading gross
 * while Net sales read net IN THE SAME ROW, so a channel with nothing
 * net-eligible showed "Net sales 0.00" next to a real, nonzero gross AOV.
 * Switching BOTH columns together off one shared basis, rather than
 * restoring a second column, is what keeps that disagreement structurally
 * impossible: at any given basis the two figures are either both gross or
 * both net, never a mix. Neither column falls back to unconverted evidence
 * when `currency` is null (an unconverted amount is a GROSS figure and
 * would misrepresent itself as net under the `net` basis), so that
 * channel's cells render a plain empty state instead — see the KPI strip's
 * own doc comment for the full nuance on that tradeoff.
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
 * The cross-reference is exact: `GET /analytics/coverage/by-connection`
 * (#2713) already returns each open category's affected-order count
 * `GROUP BY sourceConnectionId` server-side — one request
 * (`useCoverageByConnectionQuery`, `hooks/use-coverage-by-connection-query.ts`)
 * instead of draining every page of four separate order lists client-side
 * (the pre-#2714 approach, still used by `ProductSalesTable` for its
 * per-product cross-reference, which has no connection-level aggregate to
 * consume) — reshaped into the same `sourceConnectionId`-keyed map
 * (`buildChannelExclusionMap`, `lib/channel-exclusion-map.lib.ts`), since
 * that field matches this table's own row key exactly — unlike a product, a
 * channel has no ambiguity to approximate.
 *
 * @module features/analytics/components
 */
import { useMemo, type ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Chip } from '../../../shared/ui/chip';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Sparkline } from '../../../shared/ui/sparkline';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { ConnectionCell, useConnectionsQuery, type Connection } from '../../connections';
import { ConnectionDot } from '../../orders';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import { useCoverageByConnectionQuery } from '../hooks/use-coverage-by-connection-query';
import {
  createReportingCurrencyConverter,
  isCurrencyRecalculating,
  resolveReportingCurrencyRate,
} from '../lib/display-currency.lib';
import type { ChannelSalesAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { NetGrossBasis } from '../api/analytics-settings.types';
import type {
  AnalyticsCoverage,
  AnalyticsCoverageFilters,
  CoverageCategory,
} from '../api/analytics-coverage.types';
import {
  countUnconvertedOrders,
  groupChannelTotalsByCurrency,
  revenueTrendValues,
  trendTone,
  type ChannelCurrencyTotal,
} from '../lib/sales-analytics-view-model';
import {
  buildChannelExclusionMap,
  CROSS_REFERENCEABLE_CATEGORIES,
  type ChannelExclusionMap,
} from '../lib/channel-exclusion-map.lib';
import { AnalyticsExclusionNote } from './analytics-exclusion-note';
import { RecalculatingValue } from './recalculating-value';

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
        <ConnectionDot
          name={row.connection?.name ?? null}
          platformType={row.connection?.platformType}
        />
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
      {CROSS_REFERENCEABLE_CATEGORIES.filter((category) => byCategory.has(category)).map(
        (category) => (
          <AnalyticsExclusionNote
            key={category}
            category={category}
            affectedCount={byCategory.get(category) ?? 0}
            onOpenCategory={onOpenCategory}
          />
        )
      )}
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
  /**
   * VAT basis for the money/AOV columns (#2903 — wiring the #2895 toggle).
   * `'net'` (the default) reproduces this table's pre-#2903 rendering
   * exactly — `netRevenue`/`netAverageOrderValue`, labeled "Net sales"/"AOV"
   * — since that was this table's ONLY rendering before the toggle existed
   * (a prior revision that also showed gross figures was removed, see this
   * file's own module doc comment on the cohort-mismatch bug that caused).
   * `'gross'` reads `revenue`/`averageOrderValue` instead, labeled "GMV"/
   * "AOV" — a genuinely new capability this table never had, not a
   * regression risk, since both columns always switch TOGETHER under one
   * basis and can therefore never disagree with each other the way the
   * removed dual-column design once did.
   */
  netGrossBasis?: NetGrossBasis;
}

export function ChannelSalesTable({
  filters,
  coverage,
  coverageFilters,
  onOpenCategory,
  netGrossBasis = 'gross',
}: ChannelSalesTableProps): ReactElement {
  const query = useSalesAnalyticsQuery(filters);
  const connectionsQuery = useConnectionsQuery();
  const pctFormat = useNumberFormat(PERCENT_FORMAT_OPTIONS);
  const intFormat = useNumberFormat();

  // One request for every cross-referenceable category together (#2713/
  // #2714) — `enabled` only when the `coverage` prop (the unfiltered
  // GET /analytics/coverage aggregate) says at least one of them has a
  // nonzero affectedCount, matching the pre-#2714 gate's own source of
  // truth exactly (`openCategoryCodes`, unchanged) — just "any" instead of
  // "each", since there is now only one request to gate. This is the same
  // approximation the old per-category gates already made: `coverage` and
  // `crossRefFilters`/`coverageFilters` are independent props (see this
  // component's own prop doc comments), so the guarantee is "no request
  // when the panel overall reads all-clear," not a filter-range match.
  const openCategoryCodes = useMemo(
    () =>
      new Set(
        (coverage?.categories ?? [])
          .filter((row) => row.affectedCount > 0)
          .map((row) => row.category)
      ),
    [coverage]
  );
  const crossRefFilters: AnalyticsCoverageFilters = coverageFilters ?? { from: '', to: '' };
  const crossRefEnabled = Boolean(coverageFilters) && Boolean(onOpenCategory);
  const anyOpenCrossReferenceable = CROSS_REFERENCEABLE_CATEGORIES.some((category) =>
    openCategoryCodes.has(category)
  );
  const byConnection = useCoverageByConnectionQuery(
    crossRefFilters,
    crossRefEnabled && anyOpenCrossReferenceable
  );
  const exclusions = buildChannelExclusionMap(byConnection.data);

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
  const headline = query.data?.headline;
  // ADR-064 display-currency override (#2778/#2779): every channel's
  // `currency` — and `row.total.currency` — always equals `headline.currency`
  // (the one system-wide reporting currency, see this file's own doc
  // comment), so the single rate resolved for the headline bucket is the
  // exact rate for every row here too. This reuses the REAL per-bucket rate
  // the backend applied (`NativeCurrencyBreakdown.appliedRate`) — never a
  // rate derived by dividing `convertedRevenue` by `revenue`, which is
  // UNSOUND (see `display-currency.lib.ts`'s "REJECTED APPROACH" note for
  // the live bad number, 29 000 PLN read as ~20 000 "EUR", that caught it).
  // A row whose `currency` doesn't resolve to a rate stays native.
  const gmvConversion = headline?.displayCurrencyConversion;
  const reportingRate = resolveReportingCurrencyRate(gmvConversion, headline?.currency ?? null);
  const reportingConverter = createReportingCurrencyConverter(
    reportingRate,
    headline?.currency ?? null
  );
  function convertToDisplay(amount: number, nativeCurrency: string): number {
    return reportingConverter.convertToDisplay(amount, nativeCurrency);
  }
  function displayCurrencyFor(nativeCurrency: string): string {
    return reportingConverter.displayCurrencyFor(nativeCurrency);
  }
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

  // Same "in-flight recalculation" signal the KPI strip reads — see
  // `isCurrencyRecalculating`'s doc comment. Without it, a channel's Net
  // sales/AOV read as a bare 0.00 for the whole duration of a recalculation
  // run instead of disclosing that a fix is already in progress.
  const currencyRecalculating = isCurrencyRecalculating(coverage);

  // Which basis feeds the money/AOV columns — see this component's own
  // `netGrossBasis` prop doc comment. Both columns always read the SAME
  // basis, so they can never disagree with each other the way the removed
  // dual-column design once did.
  const revenueLabel = netGrossBasis === 'net' ? 'Net sales' : 'GMV';
  function revenueOf(value: { revenue: number; netRevenue: number }): number {
    return netGrossBasis === 'net' ? value.netRevenue : value.revenue;
  }
  function averageOrderValueOf(value: {
    averageOrderValue: number;
    netAverageOrderValue: number;
  }): number {
    return netGrossBasis === 'net' ? value.netAverageOrderValue : value.averageOrderValue;
  }

  function renderAovCell(row: ChannelRow): ReactElement {
    if (currencyRecalculating) {
      return <RecalculatingValue />;
    }
    if (row.kind === 'total') {
      return (
        <>
          {formatAmount(
            convertToDisplay(averageOrderValueOf(row.total), row.total.currency),
            displayCurrencyFor(row.total.currency)
          )}
        </>
      );
    }
    if (row.channel.currency !== null) {
      return (
        <>
          {formatAmount(
            convertToDisplay(averageOrderValueOf(row.channel), row.channel.currency),
            displayCurrencyFor(row.channel.currency)
          )}
        </>
      );
    }
    // No unconverted-evidence fallback, same reasoning as the money column:
    // an unconverted amount is a GROSS figure and would misrepresent itself
    // as a net average under the `net` basis.
    return <EmptyValue label="No AOV figure can be given for this channel in range" />;
  }

  function renderNovCell(row: ChannelRow): ReactElement {
    if (currencyRecalculating) {
      return row.kind === 'total' ? (
        <strong>
          <RecalculatingValue />
        </strong>
      ) : (
        <RecalculatingValue />
      );
    }
    if (row.kind === 'total') {
      return (
        <strong>
          {formatAmount(
            convertToDisplay(revenueOf(row.total), row.total.currency),
            displayCurrencyFor(row.total.currency)
          )}
        </strong>
      );
    }
    if (row.channel.currency !== null) {
      return (
        <>
          {formatAmount(
            convertToDisplay(revenueOf(row.channel), row.channel.currency),
            displayCurrencyFor(row.channel.currency)
          )}
        </>
      );
    }
    return (
      <EmptyValue label={`No ${revenueLabel} figure can be given for this channel in range`} />
    );
  }

  const columns: DataTableColumn<ChannelRow>[] = [
    {
      id: 'channel',
      header: 'Channel',
      cell: (row) =>
        row.kind === 'total' ? (
          <strong>Total · {displayCurrencyFor(row.total.currency)}</strong>
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
      header: revenueLabel,
      align: 'right',
      cell: renderNovCell,
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      cell: (row) =>
        intFormat.format(row.kind === 'total' ? row.total.orderCount : row.channel.orderCount),
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
      cell: (row) =>
        intFormat.format(row.kind === 'total' ? row.total.unitsSold : row.channel.unitsSold),
      hideBelow: 1024,
    },
    {
      id: 'share',
      header: 'Share',
      align: 'right',
      cell: (row) =>
        pctFormat.format(row.kind === 'total' ? row.total.revenueShare : row.channel.revenueShare),
      hideBelow: 768,
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (row) => {
        if (row.kind === 'total') return null;
        const values = revenueTrendValues(row.channel.trend);
        return values.length >= 2 ? (
          <Sparkline
            values={values}
            tone={trendTone(values)}
            width={72}
            height={20}
            ariaLabel="Channel revenue trend"
          />
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
        rowKey={(row) =>
          row.kind === 'total' ? `total:${row.total.currency}` : row.channel.sourceConnectionId
        }
        emptyState={<EmptyValue label="No channel has any orders in this range" />}
      />
      {unconvertedCount > 0 ? (
        <p className="data-table__footnote">
          {unconvertedCount} {unconvertedCount === 1 ? 'order' : 'orders'} not yet converted to the
          reporting currency — excluded from the figures above.
        </p>
      ) : null}
    </>
  );
}
