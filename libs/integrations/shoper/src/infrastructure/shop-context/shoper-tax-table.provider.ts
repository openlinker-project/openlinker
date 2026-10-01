/**
 * Shoper Tax Table Provider
 *
 * Reads the shop's `/taxes` table once per provider instance, so a sweep over a
 * catalogue does not issue one `/taxes` request per product. The table is a
 * handful of rows that change rarely.
 *
 * Memoised as a PROMISE (concurrent callers share one request); a failure is
 * dropped from the memo so the next call retries rather than replaying a
 * rejected promise for the adapter's lifetime. Same shape as
 * `ShoperShopContextProvider`.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import type { ShoperTax } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

export class ShoperTaxTableProvider {
  private pending: Promise<ReadonlyMap<string, ShoperTax>> | null = null;

  constructor(private readonly client: ShoperHttpClient) {}

  /** The table keyed by `tax_id`. */
  get(): Promise<ReadonlyMap<string, ShoperTax>> {
    if (this.pending === null) {
      this.pending = this.load().catch((error: unknown) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }

  private async load(): Promise<ReadonlyMap<string, ShoperTax>> {
    const table = new Map<string, ShoperTax>();
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperTax>(this.client, '/taxes', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        // Explicit, like every other read in the plugin: a bare `order=<field>`
        // sorts DESCENDING on Shoper, and an unordered paged read is not stable.
        query: { order: 'tax_id ASC' },
      });
      for (const row of result.items) {
        table.set(String(row.tax_id), row);
      }
      if (page >= result.pages) {
        return table;
      }
    }
  }
}
