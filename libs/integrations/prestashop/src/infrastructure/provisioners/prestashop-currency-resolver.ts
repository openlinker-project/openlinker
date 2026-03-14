/**
 * PrestaShop Currency Resolver
 *
 * Resolves ISO 4217 currency codes to PrestaShop currency IDs.
 * Caches results per connection to reduce API calls.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Injectable, Logger } from '@nestjs/common';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopCurrency } from './prestashop-provisioner.types';

/**
 * Cache entry with timestamp for TTL
 */
interface CacheEntry {
  currencyId: number;
  timestamp: number;
}

/**
 * Cache TTL in milliseconds (24 hours)
 * Currencies are rarely added/changed in PrestaShop, but cache should expire
 * to handle configuration changes.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Default currency ID fallback (EUR = 1 is common default in PrestaShop)
 * Used if currency lookup fails
 */
const DEFAULT_CURRENCY_ID = 1;

@Injectable()
export class PrestashopCurrencyResolver {
  private readonly logger = new Logger(PrestashopCurrencyResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve ISO 4217 currency code to PrestaShop currency ID
   *
   * Queries PrestaShop currencies by ISO code, caches result per connection.
   * Falls back to default currency ID (1 = EUR) if currency not found.
   *
   * @param isoCode - ISO 4217 currency code (e.g., 'PLN', 'EUR', 'USD')
   * @param connectionId - Connection ID for cache key
   * @param webserviceClient - PrestaShop WebService client
   * @returns PrestaShop currency ID
   */
  async resolveCurrencyId(
    isoCode: string,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient,
  ): Promise<number> {
    // Normalize ISO code (uppercase, trim)
    const normalizedIso = isoCode.trim().toUpperCase();

    // Check cache
    const cacheKey = `${connectionId}:${normalizedIso}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      // Check if cache entry is still valid (not expired)
      const now = Date.now();
      if (now - cached.timestamp < CACHE_TTL_MS) {
        this.logger.debug(`Currency ID cached: ${normalizedIso} → ${cached.currencyId}`);
        return cached.currencyId;
      } else {
        // Cache expired, remove entry
        this.cache.delete(cacheKey);
        this.logger.debug(`Cache expired for currency: ${normalizedIso}`);
      }
    }

    try {
      // Query PrestaShop currencies
      // Note: PrestashopWebserviceClient must generate filter[iso_code]=[PLN]&display=[id] format
      const currencies = await webserviceClient.listResources<PrestashopCurrency>(
        'currencies',
        {
          custom: { iso_code: normalizedIso },
        },
        1, // limit
        0, // offset
      );

      if (!currencies || currencies.length === 0) {
        this.logger.warn(
          `Currency not found in PrestaShop: ${normalizedIso} (connection: ${connectionId}), using default currency ID: ${DEFAULT_CURRENCY_ID}`,
        );
        // Cache default to avoid repeated lookups
        this.cache.set(cacheKey, {
          currencyId: DEFAULT_CURRENCY_ID,
          timestamp: Date.now(),
        });
        return DEFAULT_CURRENCY_ID;
      }

      // Extract currency ID from first result
      const currency = currencies[0];
      const currencyId = Number.parseInt(currency.id, 10);

      if (Number.isNaN(currencyId)) {
        this.logger.warn(
          `Invalid currency ID returned from PrestaShop: ${currency.id} for ISO: ${normalizedIso}, using default: ${DEFAULT_CURRENCY_ID}`,
        );
        // Cache default
        this.cache.set(cacheKey, {
          currencyId: DEFAULT_CURRENCY_ID,
          timestamp: Date.now(),
        });
        return DEFAULT_CURRENCY_ID;
      }

      // Cache result with timestamp
      this.cache.set(cacheKey, {
        currencyId,
        timestamp: Date.now(),
      });
      this.logger.debug(`Resolved currency ID: ${normalizedIso} → ${currencyId}`);

      return currencyId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to resolve currency ${normalizedIso} in PrestaShop (connection: ${connectionId}): ${errorMessage}, using default currency ID: ${DEFAULT_CURRENCY_ID}`,
      );
      // Cache default to avoid repeated failed lookups
      this.cache.set(cacheKey, {
        currencyId: DEFAULT_CURRENCY_ID,
        timestamp: Date.now(),
      });
      return DEFAULT_CURRENCY_ID;
    }
  }

  /**
   * Clear cache for a connection (useful for testing or cache invalidation)
   */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      // Clear cache entries for specific connection
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this.cache.delete(key));
    } else {
      // Clear all cache
      this.cache.clear();
    }
  }
}
