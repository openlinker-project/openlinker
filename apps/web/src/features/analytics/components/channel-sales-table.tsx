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
 * reporting currency — a channel's `netRevenue`/`averageOrderValue`/`revenueShare`
 * are always comparable when `currency` is non-null. `Orders`/`AOV` stay on
 * the same FX-stamped basis as `Net sales` so a row's own figures always
 * reconcile with each other and with the single `Total · {currency}` row
 * below.
 *
 * `Net sales`, not `GMV` (net-sales tax-rate epic): the only money column
 * here is `netRevenue` (VAT-exclusive — technically the spec's NOV until
 * returns are also modeled, but shown under the "Net sales" label per the
 * reference design mockup). A prior revision showed GMV (`revenue`, gross)
 * alongside it; that column is gone — the KPI strip above already carries
 * the GMV qualifier for the same range, so this table doesn't need to repeat
 * it, and the row's own figures reconcile cleanly against one basis instead
 * of two. There is no `unconvertedNetRevenue` to fall back to when
 * `currency` is null (an unconverted amount is a GROSS figure and would
 * misrepresent itself as net), so that channel's Net sales cell renders a
 * plain empty state instead — see the KPI strip's own doc comment for the
 * full nuance on that tradeoff.
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
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
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
import type { ChannelSalesAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';
import {
  countUnconvertedOrders,
  groupChannelTotalsByCurrency,
  revenueTrendValues,
  trendTone,
  type ChannelCurrencyTotal,
} from '../lib/sales-analytics-view-model';

const PERCENT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

const UNCONVERTED_EVIDENCE_TITLE =
  'Native-currency evidence with no FX stamp yet — informational only, not part of Net sales or any Total · {currency} row.';

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

function ChannelName({
  connectionsLoading,
  row,
}: {
  connectionsLoading: boolean;
  row: ChannelDataRow;
}): ReactElement {
  return (
    <span className="data-table__stack">
      <ChannelIdentity connectionsLoading={connectionsLoading} row={row} />
      <span>
        <ChannelFlags row={row} />
      </span>
    </span>
  );
}

interface ChannelSalesTableProps {
  filters: SalesAnalyticsFilters;
}

export function ChannelSalesTable({ filters }: ChannelSalesTableProps): ReactElement {
  const query = useSalesAnalyticsQuery(filters);
  const connectionsQuery = useConnectionsQuery();
  const pctFormat = useNumberFormat(PERCENT_FORMAT_OPTIONS);
  const intFormat = useNumberFormat();

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
      return <>{formatAmount(row.total.averageOrderValue, row.total.currency)}</>;
    }
    if (row.channel.currency !== null) {
      return <>{formatAmount(row.channel.averageOrderValue, row.channel.currency)}</>;
    }
    if (row.channel.unconvertedCurrency !== null && row.channel.unconvertedCount > 0) {
      return (
        <span title={UNCONVERTED_EVIDENCE_TITLE}>
          {formatAmount(row.channel.unconvertedValue / row.channel.unconvertedCount, row.channel.unconvertedCurrency)}
        </span>
      );
    }
    return <EmptyValue label="No average order value can be given for this channel in range" />;
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
          <ChannelName connectionsLoading={connectionsQuery.isLoading} row={row} />
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
