/**
 * Shoper Stocks
 *
 * Reads every `product-stocks` row of one product - the variant grain
 * (SPIKE-3638 M1) that both `ProductMaster` (variants) and `InventoryMaster`
 * (stock levels) are built on.
 *
 * Correctness rests on `filters[product_id]` being honoured (bracket form,
 * verified live on this resource; `/products` takes the JSON form instead).
 * Shoper silently rewrites parameters it does not accept (`limit` -> 10), so if
 * that filter were ever ignored it would answer with the WHOLE stock table and
 * every product would be handed foreign rows. A row that is not this product's
 * is therefore dropped and reported through `onForeignRows`, never returned.
 *
 * @module libs/integrations/shoper/src/infrastructure/http
 */
import type { ShoperStock } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from './shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from './shoper-pagination';

export async function fetchShoperStocks(
  client: ShoperHttpClient,
  externalProductId: string,
  onForeignRows: (count: number) => void,
): Promise<ShoperStock[]> {
  const stocks: ShoperStock[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchShoperPage<ShoperStock>(client, '/product-stocks', {
      page,
      limit: SHOPER_MAX_PAGE_SIZE,
      query: { 'filters[product_id]': externalProductId, order: 'stock_id ASC' },
    });
    const own = result.items.filter((s) => String(s.product_id) === externalProductId);
    if (own.length < result.items.length) {
      onForeignRows(result.items.length - own.length);
    }
    stocks.push(...own);
    if (page >= result.pages) {
      return stocks;
    }
  }
}
