/**
 * "Top products" CSV (#3589): the FULL ranking for the filters, paged
 * internally from the same `ITopProductsService.getTopProducts` the JSON
 * route uses. Columns mirror the on-screen product table: product, SKU,
 * revenue (by VAT basis), units, then units per channel.
 *
 * @module apps/api/src/analytics/http
 */
import type { Readable } from 'node:stream';
import type { NetGrossBasis } from '@openlinker/core/analytics';
import { csvHeaderComments, csvStream, type CsvColumn } from '@openlinker/shared/csv';
import type { TopProductFilters } from '@openlinker/core/orders';
import type { TopProductRowDto, TopProductsResponseDto } from './dto/top-products-response.dto';
import { toInclusiveDay } from './export-range';

export const TOP_PRODUCTS_CSV_PAGE_SIZE = 500;

export type TopProductsPageReader = (filters: TopProductFilters) => Promise<TopProductsResponseDto>;

export async function readAllTopProducts(
  read: TopProductsPageReader,
  base: Omit<TopProductFilters, 'limit' | 'offset'>
): Promise<TopProductRowDto[]> {
  const all: TopProductRowDto[] = [];
  let offset = 0;
  for (;;) {
    const page = await read({ ...base, limit: TOP_PRODUCTS_CSV_PAGE_SIZE, offset });
    all.push(...page.items);
    offset += TOP_PRODUCTS_CSV_PAGE_SIZE;
    if (page.items.length < TOP_PRODUCTS_CSV_PAGE_SIZE || offset >= page.total) {
      return all;
    }
  }
}

export function buildTopProductsCsv(input: {
  rows: readonly TopProductRowDto[];
  from: Date;
  to: Date;
  basis: NetGrossBasis;
  now?: Date;
}): { stream: Readable; currency: string } {
  const { rows, basis } = input;
  const currency = rows.find((r) => r.currency !== null)?.currency ?? 'unconverted';
  const channelIds = [...new Set(rows.flatMap((r) => r.channels.map((c) => c.sourceConnectionId)))];
  const revenueOf = (r: TopProductRowDto): number => (basis === 'net' ? r.netRevenue : r.revenue);

  const columns: CsvColumn<TopProductRowDto>[] = [
    { header: 'product', value: (r) => r.name ?? r.productId },
    { header: 'product_id', value: (r) => r.productId },
    { header: 'sku', value: (r) => r.sku },
    { header: basis === 'net' ? 'net_sales' : 'gmv', value: (r) => revenueOf(r).toFixed(2) },
    { header: 'currency', value: (r) => r.currency },
    { header: 'units', value: (r) => r.units },
    ...channelIds.map(
      (id): CsvColumn<TopProductRowDto> => ({
        header: `units_${id}`,
        value: (r) => r.channels.find((c) => c.sourceConnectionId === id)?.units ?? 0,
      })
    ),
  ];

  const comments = csvHeaderComments([
    { key: 'report', value: 'OpenLinker top products' },
    {
      key: 'range',
      value: `${input.from.toISOString().slice(0, 10)}..${toInclusiveDay(input.to)} (order date)`,
    },
    { key: 'currency', value: `${currency} (reporting currency)` },
    { key: 'vat basis', value: basis === 'net' ? 'net (VAT-exclusive)' : 'gross (VAT-inclusive)' },
    { key: 'cancelled orders', value: 'excluded' },
    { key: 'generated', value: (input.now ?? new Date()).toISOString() },
  ]);

  return { stream: csvStream(columns, rows, { comments }), currency };
}
