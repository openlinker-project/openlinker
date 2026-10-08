/**
 * Shoper Order Reference Provider
 *
 * The three shop tables an INCOMING order needs to be read in OpenLinker's own
 * words: a status id -> its lifecycle `type` and labels, a `currency_id` -> its ISO
 * code and a `shipping_id` -> the method's display name. The order row carries ids
 * only.
 *
 * Two levels of memo. Per instance, as PROMISES (concurrent callers share one
 * request; a transport failure is dropped so the next call retries). And, when the
 * host cache is wired, across instances: `getCapabilityAdapter` builds a fresh
 * adapter bag per call, so a per-instance memo alone would repeat these reads in
 * every `marketplace.order.sync` job against a shop whose request ceiling is
 * unknown - the reason `ShoperShopContextProvider` already reads through the host
 * cache. The tables change rarely, so a few minutes of staleness is harmless. An
 * id the shop does not list resolves to `null`: it is the shop's answer, not a
 * fault.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import type { CachePort } from '@openlinker/shared';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import type {
  ShoperCurrency,
  ShoperStatusRow,
} from '../../domain/types/shoper-api.types';
import type { ShoperOrderStatusInfo } from '../../domain/types/shoper-order-status.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

export const ORDER_REFERENCE_CACHE_TTL_SEC = 300;

export interface ShoperOrderReferenceCacheOptions {
  readonly cache?: CachePort | undefined;
  /** Connection-scoped key prefix; without it (or without a cache) nothing is shared across instances. */
  readonly keyPrefix?: string;
}

function isStatusInfo(value: unknown): value is ShoperOrderStatusInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type, labels } = value as { type?: unknown; labels?: unknown };
  return (
    typeof type === 'number' &&
    Number.isInteger(type) &&
    Array.isArray(labels) &&
    labels.every((label) => typeof label === 'string')
  );
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export class ShoperOrderReferenceProvider {
  private statuses: Promise<ReadonlyMap<string, ShoperOrderStatusInfo>> | null = null;
  private currencyCodes: Promise<ReadonlyMap<string, string>> | null = null;
  private readonly shippingNames = new Map<string, Promise<string | null>>();

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly cacheOptions: ShoperOrderReferenceCacheOptions = {},
  ) {}

  /** A status's lifecycle type (1 new .. 4 terminal) and labels, or null when the shop lists no usable type. */
  async getStatus(statusId: string): Promise<ShoperOrderStatusInfo | null> {
    this.statuses ??= this.throughCache('statuses', isStatusInfo, () => this.loadAll<ShoperStatusRow, ShoperOrderStatusInfo>(
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
    )).catch((error: unknown) => {
      this.statuses = null;
      throw error;
    });
    return (await this.statuses).get(statusId) ?? null;
  }

  /** The ISO code (`PLN`) of a `currency_id`, or null when the shop lists none. */
  async getCurrencyCode(currencyId: string): Promise<string | null> {
    this.currencyCodes ??= this.throughCache('currencies', isCurrencyCode, () => this.loadAll<ShoperCurrency, string>(
      '/currencies',
      'currency_id ASC',
      (row) => {
        const code = typeof row.name === 'string' ? row.name.trim().toUpperCase() : '';
        return code.length > 0 ? [String(row.currency_id), code] : null;
      },
    )).catch((error: unknown) => {
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
    const { cache, keyPrefix } = this.cacheOptions;
    const key = cache === undefined || keyPrefix === undefined ? null : `${keyPrefix}:shipping:${shippingId}`;
    if (cache !== undefined && key !== null) {
      try {
        const cached = await cache.get<{ name: string | null }>(key);
        if (cached !== null && typeof cached === 'object' && (cached.name === null || typeof cached.name === 'string')) {
          return cached.name;
        }
      } catch {
        // Best-effort: fall through and ask the shop.
      }
    }

    const name = await this.readShippingName(shippingId);
    if (cache !== undefined && key !== null) {
      try {
        await cache.set(key, { name }, ORDER_REFERENCE_CACHE_TTL_SEC);
      } catch {
        // Best-effort: the next resolution simply asks the shop again.
      }
    }
    return name;
  }

  private async readShippingName(shippingId: string): Promise<string | null> {
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

  /**
   * Reads a whole table through the host cache when one is wired. A cached entry
   * written by another release is not trusted blindly, and an EMPTY table is never
   * stored or served: a shop that really lists nothing costs one request per
   * resolution, whereas caching an empty answer would hide a transient fluke for
   * the whole TTL.
   */
  private async throughCache<V>(
    name: string,
    isValue: (value: unknown) => value is V,
    load: () => Promise<ReadonlyMap<string, V>>,
  ): Promise<ReadonlyMap<string, V>> {
    const { cache, keyPrefix } = this.cacheOptions;
    if (cache === undefined || keyPrefix === undefined) {
      return load();
    }
    const key = `${keyPrefix}:${name}`;

    const cached = await this.readTable(cache, key, isValue);
    if (cached !== null) {
      return cached;
    }
    const fresh = await load();
    if (fresh.size > 0) {
      try {
        await cache.set(key, [...fresh.entries()], ORDER_REFERENCE_CACHE_TTL_SEC);
      } catch {
        // Best-effort: the next resolution simply asks the shop again.
      }
    }
    return fresh;
  }

  private async readTable<V>(
    cache: CachePort,
    key: string,
    isValue: (value: unknown) => value is V,
  ): Promise<ReadonlyMap<string, V> | null> {
    try {
      const raw = await cache.get<unknown>(key);
      if (!Array.isArray(raw) || raw.length === 0) {
        return null;
      }
      const table = new Map<string, V>();
      for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !isValue(entry[1])) {
          return null;
        }
        table.set(entry[0], entry[1]);
      }
      return table;
    } catch {
      return null;
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
