/**
 * Shoper Shop Context Provider
 *
 * Reads the few facts about a shop the mapper needs that are not on the product
 * payload - default language, default currency and weight unit - from
 * `GET /application-config`.
 *
 * Two layers keep that read cheap:
 *   - **Per instance:** the in-flight request is memoised as a PROMISE, so
 *     concurrent callers share one round-trip, and a FAILURE is dropped from
 *     the memo so the next call retries instead of replaying a rejected promise
 *     for the adapter's lifetime.
 *   - **Across instances:** `getCapabilityAdapter` builds a fresh adapter on
 *     every call, so without more the read would repeat once per product job.
 *     When the host cache is wired, a short-TTL entry carries the answer
 *     between resolutions. The cache is strictly best-effort: a cache read or
 *     write that fails is ignored and the shop is asked instead. The facts are
 *     slow-moving (a shop rarely changes its default language), and a change
 *     reaches OpenLinker within the TTL.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import type { CachePort } from '@openlinker/shared';

import { SHOPER_CONNECTION_TEST_PATH } from '../../shoper.constants';
import type { ShoperApplicationConfig } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import type { ShoperMapContext } from '../mappers/shoper-product.mapper';

/** Used only when the shop omits `locale_default_weight`; kilograms is Shoper's default unit. */
const FALLBACK_WEIGHT_UNIT = 'KILOGRAM';

/** How long a resolved shop context is reused across adapter resolutions. */
export const SHOP_CONTEXT_CACHE_TTL_SEC = 300;

export interface ShoperShopContextCacheOptions {
  readonly cache?: CachePort | undefined;
  /** Must be unique per connection AND host, so one connection's answer is never served to another. */
  readonly cacheKey?: string;
}

export class ShoperShopContextProvider {
  private pending: Promise<ShoperMapContext> | null = null;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly host: string,
    private readonly cacheOptions: ShoperShopContextCacheOptions = {},
  ) {}

  get(): Promise<ShoperMapContext> {
    if (this.pending === null) {
      this.pending = this.loadThroughCache().catch((error: unknown) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }

  private async loadThroughCache(): Promise<ShoperMapContext> {
    const { cache, cacheKey } = this.cacheOptions;
    if (cache === undefined || cacheKey === undefined) {
      return this.load();
    }

    const cached = await this.readCache(cache, cacheKey);
    if (cached !== null) {
      return cached;
    }

    const fresh = await this.load();
    try {
      await cache.set(cacheKey, fresh, SHOP_CONTEXT_CACHE_TTL_SEC);
    } catch {
      // Best-effort: the next resolution simply asks the shop again.
    }
    return fresh;
  }

  private async readCache(cache: CachePort, key: string): Promise<ShoperMapContext | null> {
    try {
      const value = await cache.get<ShoperMapContext>(key);
      return isUsableContext(value) ? { ...value, host: this.host } : null;
    } catch {
      return null;
    }
  }

  private async load(): Promise<ShoperMapContext> {
    const { data } = await this.client.get<Partial<ShoperApplicationConfig>>(
      SHOPER_CONNECTION_TEST_PATH,
    );
    return {
      host: this.host,
      language: data.default_language_name ?? '',
      currency: data.default_currency_name ?? null,
      weightUnit: data.locale_default_weight ?? FALLBACK_WEIGHT_UNIT,
    };
  }
}

/** A cache entry written by another release must not be trusted blindly. */
function isUsableContext(value: ShoperMapContext | null): value is ShoperMapContext {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.language === 'string' &&
    typeof value.weightUnit === 'string' &&
    (value.currency === null || typeof value.currency === 'string')
  );
}
