/**
 * Margin CSVs (#3589, G11-H): "margin by channel" and "margin by product",
 * built from the SAME figures the JSON routes return. Margin is always on NET
 * revenue, so there is no basis choice. A percentage is written as a percent
 * number with one decimal from the same ratio the JSON carries; a ratio that is
 * null (nothing covered / no revenue) is an EMPTY cell, never 0.
 *
 * @module apps/api/src/analytics/http
 */
import type { Readable } from 'node:stream';
import type { MarginProductFilters } from '@openlinker/core/orders';
import { csvHeaderComments, csvStream, type CsvColumn } from '@openlinker/shared/csv';
import type {
  MarginAnalyticsResponseDto,
  MarginFigDto,
  MarginProductRowDto,
  MarginProductsResponseDto,
} from './dto/margin-analytics-response.dto';
import { toInclusiveDay } from './export-range';
import { channelCells, type ConnectionLabels } from './connection-labels';

export const MARGIN_CSV_PAGE_SIZE = 500;

type Fig = Omit<MarginFigDto, 'assignFigures'>;

const money = (value: number): string => value.toFixed(2);
const pct = (ratio: number | null): string | null =>
  ratio === null ? null : (ratio * 100).toFixed(1);

function figureColumns<Row extends Fig>(): CsvColumn<Row>[] {
  return [
    { header: 'net_revenue', value: (r) => money(r.netRevenue) },
    { header: 'covered_net_revenue', value: (r) => money(r.coveredNetRevenue) },
    { header: 'cost_of_goods', value: (r) => money(r.costOfGoods) },
    // Nothing covered means there is no margin to state, not a margin of 0.
    {
      header: 'gross_margin',
      value: (r) => (r.marginPct === null ? null : money(r.grossMargin)),
    },
    { header: 'margin_pct', value: (r) => pct(r.marginPct) },
    { header: 'cost_coverage_pct', value: (r) => pct(r.costCoveragePct) },
  ];
}

function comments(input: {
  report: string;
  from: Date;
  to: Date;
  currency: string;
  headline: Fig | null;
  now?: Date;
}): string[] {
  const lines = csvHeaderComments([
    { key: 'report', value: `OpenLinker ${input.report}` },
    {
      key: 'range',
      value: `${input.from.toISOString().slice(0, 10)}..${toInclusiveDay(input.to)} (order date)`,
    },
    { key: 'currency', value: `${input.currency} (reporting currency)` },
    { key: 'basis', value: 'net (VAT-exclusive)' },
    { key: 'cancelled orders', value: 'excluded' },
    { key: 'generated', value: (input.now ?? new Date()).toISOString() },
  ]);
  if (input.headline !== null) {
    const lineCount = input.headline.gaps.reduce((s, g) => s + g.lineCount, 0);
    const netAmount = input.headline.gaps.reduce((s, g) => s + g.netAmount, 0);
    lines.push(
      `# Lines without a cost are excluded from cost and margin: ${lineCount} lines, ${input.currency} ${money(netAmount)} net revenue`
    );
  }
  return lines;
}

interface ChannelRow extends Fig {
  channel: string;
  connection: string;
  connectionId: string;
}

export function buildMarginByChannelCsv(input: {
  analytics: MarginAnalyticsResponseDto;
  from: Date;
  to: Date;
  labels: ConnectionLabels;
  now?: Date;
}): Readable {
  const { analytics } = input;
  const rows: ChannelRow[] = analytics.channels.map((c) => ({
    ...c,
    ...channelCells(input.labels, c.sourceConnectionId),
    connectionId: c.sourceConnectionId,
  }));
  rows.push({ ...analytics.headline, channel: 'Total', connection: '', connectionId: '' });

  const columns: CsvColumn<ChannelRow>[] = [
    { header: 'channel', value: (r) => r.channel },
    { header: 'connection', value: (r) => r.connection },
    ...figureColumns<ChannelRow>(),
    { header: 'connection_id', value: (r) => r.connectionId },
  ];
  return csvStream(columns, rows, {
    comments: comments({
      report: 'margin by channel',
      from: input.from,
      to: input.to,
      currency: analytics.currency,
      headline: analytics.headline,
      now: input.now,
    }),
  });
}

export type MarginProductsPageReader = (
  filters: MarginProductFilters
) => Promise<MarginProductsResponseDto>;

export async function readAllMarginProducts(
  read: MarginProductsPageReader,
  base: Omit<MarginProductFilters, 'limit' | 'offset'>
): Promise<{ rows: MarginProductRowDto[]; currency: string | null }> {
  const rows: MarginProductRowDto[] = [];
  let currency: string | null = null;
  let offset = 0;
  for (;;) {
    const page = await read({ ...base, limit: MARGIN_CSV_PAGE_SIZE, offset });
    currency = page.currency;
    rows.push(...page.items);
    offset += MARGIN_CSV_PAGE_SIZE;
    if (page.items.length < MARGIN_CSV_PAGE_SIZE || offset >= page.total) {
      return { rows, currency };
    }
  }
}

export function buildMarginByProductCsv(input: {
  rows: readonly MarginProductRowDto[];
  currency: string;
  from: Date;
  to: Date;
  now?: Date;
}): Readable {
  const columns: CsvColumn<MarginProductRowDto>[] = [
    { header: 'product', value: (r) => r.name ?? r.productId },
    { header: 'sku', value: (r) => r.sku },
    ...figureColumns<MarginProductRowDto>(),
    { header: 'product_id', value: (r) => r.productId },
  ];
  return csvStream(columns, input.rows, {
    comments: comments({
      report: 'margin by product',
      from: input.from,
      to: input.to,
      currency: input.currency,
      headline: null,
      now: input.now,
    }),
  });
}
