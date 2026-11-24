/**
 * Shoper Stocks
 *
 * Reads every `product-stocks` row of one product, or of a chunk of products
 * for a bulk prefetch - the variant grain
 * (SPIKE-3638 M1) that both `ProductMaster` (variants) and `InventoryMaster`
 * (stock levels) are built on.
 *
 * Correctness rests on `filters[product_id]` being honoured (bracket form,
 * verified live on this resource; the bulk read uses the JSON
 * `{"product_id":{"in":[..]}}` form, also verified live on `/product-stocks`).
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

/**
 * The stock rows of MANY products in one filtered read, for a bulk prefetch
 * (`BulkProductReader` / `BulkInventoryReader`): `filters={"product_id":{"in":[..]}}`
 * on `/product-stocks` (JSON form, live-verified for `in`), paged to the end.
 * The caller chunks the ids; a chunk costs as many requests as its rows need
 * pages of 50, against one request per product on the per-product path.
 *
 * Every requested id gets a bucket, empty when the shop returned no row for it.
 * What an empty bucket MEANS is the caller's decision (see each prefetch).
 *
 * THROWS when a row of an id nobody asked for comes back: that is the shape of a
 * dropped filter answering with the whole stock table, and every requested
 * product would otherwise be handed an empty bucket. The prefetch catches it and
 * falls back to the per-product reads.
 */
export async function fetchShoperStocksForProducts(
  client: ShoperHttpClient,
  externalProductIds: readonly string[],
): Promise<Map<string, ShoperStock[]>> {
  const buckets = new Map<string, ShoperStock[]>(externalProductIds.map((id) => [id, []]));
  const filters = JSON.stringify({ product_id: { in: externalProductIds.map(Number) } });
  for (let page = 1; ; page += 1) {
    const result = await fetchShoperPage<ShoperStock>(client, '/product-stocks', {
      page,
      limit: SHOPER_MAX_PAGE_SIZE,
      query: { filters, order: 'stock_id ASC' },
    });
    for (const stock of result.items) {
      const bucket = buckets.get(String(stock.product_id));
      if (bucket === undefined) {
        throw new Error(
          `Shoper answered a product-stocks read for ${externalProductIds.length} ` +
            `product(s) with a row of product ${String(stock.product_id)}, which was not ` +
            'asked for - the filter was not applied',
        );
      }
      bucket.push(stock);
    }
    if (result.items.length === 0 || page >= result.pages) {
      return buckets;
    }
  }
}
