/**
 * "Sales by channel" CSV (#3589) — built from the SAME `SalesAndChannelAnalytics`
 * the JSON response is mapped from, mirroring the on-screen channel table
 * (`channel-sales-table.tsx`): one row per channel, then a Total row.
 *
 * Figures are in the REPORTING currency. The screen may convert them to a
 * display currency client-side from the headline's applied rate; the server
 * does not repeat that per-figure conversion here, so a requested display
 * currency is stated in the header comments as not applied.
 *
 * @module apps/api/src/analytics/http
 */
import type { Readable } from 'node:stream';
import type { NetGrossBasis } from '@openlinker/core/analytics';
import type { ChannelSalesAnalytics, SalesAndChannelAnalytics } from '@openlinker/core/orders';
import { csvHeaderComments, csvStream, type CsvColumn } from '@openlinker/shared/csv';
import { toInclusiveDay } from './export-range';

interface ChannelCsvRow {
  readonly channel: string;
  readonly connectionId: string;
  readonly revenue: number | null;
  readonly orders: number;
  readonly aov: number | null;
  readonly units: number;
  readonly share: number | null;
}

const money = (value: number | null): string | null => (value === null ? null : value.toFixed(2));

export function buildSalesByChannelRows(
  channels: readonly ChannelSalesAnalytics[],
  basis: NetGrossBasis
): ChannelCsvRow[] {
  const revenueOf = (c: ChannelSalesAnalytics): number => (basis === 'net' ? c.netRevenue : c.revenue);
  const aovOf = (c: ChannelSalesAnalytics): number | null =>
    basis === 'net' ? c.netAverageOrderValue : c.averageOrderValue;

  const rows: ChannelCsvRow[] = channels.map((c) => ({
    channel: c.sourceConnectionId,
    connectionId: c.sourceConnectionId,
    revenue: c.currency === null ? null : revenueOf(c),
    orders: c.orderCount,
    aov: c.currency === null ? null : aovOf(c),
    units: c.unitsSold + c.unconvertedUnitsSold,
    share: c.revenueShare,
  }));

  // Same rule as the screen's `groupChannelTotalsByCurrency`: only channels
  // that carry the reporting currency contribute to the single Total.
  const reportingCurrency = channels.find((c) => c.currency !== null)?.currency ?? null;
  if (reportingCurrency !== null) {
    const contributing = channels.filter((c) => c.currency === reportingCurrency);
    const sum = (pick: (c: ChannelSalesAnalytics) => number): number =>
      contributing.reduce((acc, c) => acc + pick(c), 0);
    const orderCount = sum((c) => c.orderCount);
    const revenue = sum(revenueOf);
    const nonExcludedOrders =
      basis === 'net' ? orderCount - sum((c) => c.netExcludedCount) : orderCount;
    rows.push({
      channel: 'Total',
      connectionId: '',
      revenue,
      orders: orderCount,
      aov: nonExcludedOrders === 0 ? 0 : revenue / nonExcludedOrders,
      units: sum((c) => c.unitsSold + c.unconvertedUnitsSold),
      share: sum((c) => c.revenueShare ?? 0),
    });
  }
  return rows;
}

export function reportingCurrencyOf(analytics: SalesAndChannelAnalytics): string {
  return analytics.headline.currency ?? analytics.channels.find((c) => c.currency !== null)?.currency ?? 'unconverted';
}

export function buildSalesByChannelCsv(input: {
  analytics: SalesAndChannelAnalytics;
  from: Date;
  to: Date;
  basis: NetGrossBasis;
  displayCurrencyRequested?: string;
  now?: Date;
}): Readable {
  const { analytics, basis } = input;
  const currency = reportingCurrencyOf(analytics);
  const revenueLabel = basis === 'net' ? 'net_sales' : 'gmv';
  const columns: CsvColumn<ChannelCsvRow>[] = [
    { header: 'channel', value: (r) => r.channel },
    { header: 'connection_id', value: (r) => r.connectionId },
    { header: revenueLabel, value: (r) => money(r.revenue) },
    { header: 'orders', value: (r) => r.orders },
    { header: 'aov', value: (r) => money(r.aov) },
    { header: 'units', value: (r) => r.units },
    { header: 'share_pct', value: (r) => (r.share === null ? null : (r.share * 100).toFixed(1)) },
  ];

  const entries = [
    {
      key: 'report',
      value: 'OpenLinker sales by channel',
    },
    {
      key: 'range',
      value: `${input.from.toISOString().slice(0, 10)}..${toInclusiveDay(input.to)} (order date)`,
    },
    { key: 'currency', value: `${currency} (reporting currency)` },
    {
      key: 'vat basis',
      value: basis === 'net' ? 'net (VAT-exclusive)' : 'gross (VAT-inclusive)',
    },
    { key: 'cancelled orders', value: 'excluded' },
    { key: 'generated', value: (input.now ?? new Date()).toISOString() },
  ];
  if (input.displayCurrencyRequested !== undefined && input.displayCurrencyRequested !== currency) {
    entries.push({
      key: 'display currency',
      value: `${input.displayCurrencyRequested} requested but not applied; figures are in ${currency}`,
    });
  }

  return csvStream(columns, buildSalesByChannelRows(analytics.channels, basis), {
    comments: csvHeaderComments(entries),
  });
}
