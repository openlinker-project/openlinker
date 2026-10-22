/**
 * Shoper Order Options Provider
 *
 * The two shop facts an order needs that are not on the order: the tax of the
 * chosen shipping method (`shipping_tax_id`) and the id of the order's currency.
 * Memoised as PROMISES per provider instance (concurrent callers share one
 * request, a failure is dropped so the next call retries), the shape of
 * `ShoperTaxTableProvider`.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import type { ShoperCurrency, ShoperShipping } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

export class ShoperOrderOptionsProvider {
  private readonly shippings = new Map<string, Promise<ShoperShipping>>();
  private currencies: Promise<ReadonlyMap<string, string>> | null = null;

  constructor(private readonly client: ShoperHttpClient) {}

  /** The `tax_id` of a shipping method; a 404 (unknown method) is the caller's to translate. */
  async getShippingTaxId(shippingId: number): Promise<string> {
    const key = String(shippingId);
    let read = this.shippings.get(key);
    if (read === undefined) {
      read = this.client.get<ShoperShipping>(`/shippings/${key}`).then((r) => r.data);
      this.shippings.set(key, read);
      read.catch(() => this.shippings.delete(key));
    }
    return String((await read).tax_id);
  }

  /** The Shoper `currency_id` for an ISO code (`PLN`), or null when the shop has none. */
  async getCurrencyId(code: string): Promise<string | null> {
    if (this.currencies === null) {
      this.currencies = this.loadCurrencies().catch((error: unknown) => {
        this.currencies = null;
        throw error;
      });
    }
    return (await this.currencies).get(code.trim().toUpperCase()) ?? null;
  }

  private async loadCurrencies(): Promise<ReadonlyMap<string, string>> {
    const byName = new Map<string, string>();
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperCurrency>(this.client, '/currencies', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { order: 'currency_id ASC' },
      });
      for (const row of result.items) {
        byName.set(String(row.name).trim().toUpperCase(), String(row.currency_id));
      }
      if (page >= result.pages) {
        return byName;
      }
    }
  }
}
