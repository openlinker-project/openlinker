/**
 * Shoper Order Reference Provider
 *
 * The three shop tables an INCOMING order needs to be read in OpenLinker's own
 * words: a status id -> its lifecycle `type` and labels, a `currency_id` -> its ISO code and
 * a `shipping_id` -> the method's display name. The order row carries ids only.
 *
 * Memoised as PROMISES per provider instance (concurrent callers share one
 * request; a transport failure is dropped so the next call retries), the shape of
 * `ShoperOrderOptionsProvider`. An id the shop does not list resolves to `null`:
 * it is the shop's answer, not a fault.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import type {
  ShoperCurrency,
  ShoperStatusRow,
} from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

/** What the shop says about an order status: its lifecycle type and every label it carries. */
export interface ShoperOrderStatusInfo {
  readonly type: number;
  readonly labels: readonly string[];
}

export class ShoperOrderReferenceProvider {
  private statuses: Promise<ReadonlyMap<string, ShoperOrderStatusInfo>> | null = null;
  private currencyCodes: Promise<ReadonlyMap<string, string>> | null = null;
  private readonly shippingNames = new Map<string, Promise<string | null>>();

  constructor(private readonly client: ShoperHttpClient) {}

  /** A status's lifecycle type (1 new .. 4 terminal) and labels, or null when the shop lists no usable type. */
  async getStatus(statusId: string): Promise<ShoperOrderStatusInfo | null> {
    this.statuses ??= this.loadAll<ShoperStatusRow, ShoperOrderStatusInfo>(
      '/statuses',
      'status_id ASC',
      (row) => {
        // `Number(null)` is 0, which would read an absent type as a real one.
        const type = row.type === null || row.type === undefined ? Number.NaN : Number(row.type);
        if (!Number.isInteger(type)) {
          return null;
        }
        const labels = Object.values(row.translations ?? {})
          .map((t) => t?.name)
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
        return [String(row.status_id), { type, labels }];
      },
    ).catch((error: unknown) => {
      this.statuses = null;
      throw error;
    });
    return (await this.statuses).get(statusId) ?? null;
  }

  /** The ISO code (`PLN`) of a `currency_id`, or null when the shop lists none. */
  async getCurrencyCode(currencyId: string): Promise<string | null> {
    this.currencyCodes ??= this.loadAll<ShoperCurrency, string>(
      '/currencies',
      'currency_id ASC',
      (row) => {
        const code = typeof row.name === 'string' ? row.name.trim().toUpperCase() : '';
        return code.length > 0 ? [String(row.currency_id), code] : null;
      },
    ).catch((error: unknown) => {
      this.currencyCodes = null;
      throw error;
    });
    return (await this.currencyCodes).get(currencyId) ?? null;
  }

  /** The display name of a shipping method, or null when it is unknown or has none. */
  getShippingName(shippingId: string): Promise<string | null> {
    let read = this.shippingNames.get(shippingId);
    if (read === undefined) {
      read = this.loadShippingName(shippingId).catch((error: unknown) => {
        this.shippingNames.delete(shippingId);
        throw error;
      });
      this.shippingNames.set(shippingId, read);
    }
    return read;
  }

  private async loadShippingName(shippingId: string): Promise<string | null> {
    try {
      const { data } = await this.client.get<{ name?: string | null }>(`/shippings/${shippingId}`);
      return typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : null;
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        return null;
      }
      throw error;
    }
  }

  private async loadAll<T, V>(
    path: string,
    order: string,
    pick: (row: T) => readonly [string, V] | null,
  ): Promise<ReadonlyMap<string, V>> {
    const table = new Map<string, V>();
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<T>(this.client, path, {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        // Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper.
        query: { order },
      });
      for (const row of result.items) {
        const entry = pick(row);
        if (entry !== null) {
          table.set(entry[0], entry[1]);
        }
      }
      if (page >= result.pages) {
        return table;
      }
    }
  }
}
