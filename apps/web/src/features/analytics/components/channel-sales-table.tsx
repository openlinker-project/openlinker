/**
 * By-channel sales table (#1990)
 *
 * `ChannelSalesAnalyticsDto` carries only `sourceConnectionId` — no display
 * name, platform type, or brand colour — so this component joins against
 * `useConnectionsQuery()` and renders identity through `ConnectionCell`
 * (batched-lookup connection column) with a `ConnectionDot` adornment for
 * the per-channel colour.
 *
 * Money column (#1987/#2049/ADR-040): a channel's `revenueBasis` decides how
 * its revenue is rendered — `'reporting'` is comparable to headline revenue
 * (its `revenueShare` renders as a percentage); `'native'` is a real number
 * in the channel's own currency but is NEVER divided against headline
 * revenue (share always renders empty, with an inline comparability note);
 * `'unavailable'` renders empty for both. `taxTreatment: 'mixed'` renders an
 * inline chip stating the channel isn't on a normalised gross/net basis,
 * rather than silently implying its figures compare 1:1 with another
 * channel's.
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
import { revenueTrendValues, trendTone } from '../lib/sales-analytics-view-model';

const PERCENT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

interface ChannelRow {
  channel: ChannelSalesAnalytics;
  connection: Connection | undefined;
}

function ChannelIdentity({
  connectionsLoading,
  row,
}: {
  connectionsLoading: boolean;
  row: ChannelRow;
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

function ChannelFlags({ row }: { row: ChannelRow }): ReactElement | null {
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
  if (row.channel.revenueBasis === 'native') {
    flags.push(
      <Chip
        key="native"
        tone="info"
        title="No FX-stamped order exists for this channel in range, so its revenue is shown in its own currency and not compared against headline revenue."
      >
        Own currency
      </Chip>
    );
  }
  if (row.channel.taxTreatment === 'mixed') {
    flags.push(
      <Chip
        key="tax-mixed"
        tone="info"
        title="This channel's orders assert both gross and net pricing — its figures are not on a normalised gross/net basis and should not be compared 1:1 against another channel."
      >
        Gross/net mixed
      </Chip>
    );
  }
  if (flags.length === 0) return null;
  return <>{flags}</>;
}

function ChannelName({ connectionsLoading, row }: { connectionsLoading: boolean; row: ChannelRow }): ReactElement {
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
  const reportingCurrency = query.data?.headline.reportingCurrency;
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c]));
  const rows: ChannelRow[] = channels.map((channel) => ({
    channel,
    connection: connectionsById.get(channel.sourceConnectionId),
  }));

  function renderRevenueCell(row: ChannelRow): ReactElement {
    if (row.channel.revenueBasis === 'unavailable' || row.channel.revenue === null) {
      return <EmptyValue label="No revenue figure can be given for this channel in range" />;
    }
    const currency = row.channel.revenueBasis === 'native' ? row.channel.nativeCurrency ?? undefined : reportingCurrency;
    return <>{formatAmount(row.channel.revenue, currency)}</>;
  }

  function renderShareCell(row: ChannelRow): ReactElement {
    if (row.channel.revenueShare === null) {
      return <EmptyValue label="Share not comparable to headline revenue for this channel" />;
    }
    return <>{pctFormat.format(row.channel.revenueShare)}</>;
  }

  const columns: DataTableColumn<ChannelRow>[] = [
    {
      id: 'channel',
      header: 'Channel',
      cell: (row) => <ChannelName connectionsLoading={connectionsQuery.isLoading} row={row} />,
    },
    {
      id: 'revenue',
      header: 'Revenue',
      align: 'right',
      cell: renderRevenueCell,
    },
    {
      id: 'share',
      header: 'Share',
      align: 'right',
      cell: renderShareCell,
      hideBelow: 768,
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      cell: (row) => intFormat.format(row.channel.orderCount),
      hideBelow: 480,
    },
    {
      id: 'aov',
      header: 'AOV',
      align: 'right',
      cell: (row) =>
        formatAmount(
          row.channel.averageOrderValue,
          row.channel.revenueBasis === 'native' ? row.channel.nativeCurrency ?? undefined : reportingCurrency
        ),
      hideBelow: 768,
    },
    {
      id: 'units',
      header: 'Units',
      align: 'right',
      cell: (row) => intFormat.format(row.channel.unitsSold),
      hideBelow: 1024,
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (row) => {
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

  return (
    <DataTable
      caption="Sales by channel"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.channel.sourceConnectionId}
      emptyState={<EmptyValue label="No channel has any orders in this range" />}
    />
  );
}
