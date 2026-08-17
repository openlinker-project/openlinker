/**
 * PrestaShop Currency Resolver
 *
 * Resolves ISO 4217 currency codes to PrestaShop currency IDs.
 * Caches successful resolutions per connection to reduce API calls.
 *
 * Refuses rather than guesses (#2139). Until then every failure branch returned
 * a hardcoded id `1`, so an order in a currency the destination shop does not
 * carry was booked under whichever currency that shop happened to create first,
 * with the buyer's raw amounts - the right numbers under the wrong
 * denomination, reported to the operator as a success. The same reasoning ADR-014
 * / #895 applies to prices applies here: a visibly failed order beats a quietly
 * mis-denominated financial document. A deployment that genuinely wants a
 * permissive fallback should get an explicit per-connection setting, not an
 * unconditional constant.
 *
 * Two failure kinds, two exception classes, because the class IS the retry
 * decision (see `PrestashopRetryClassifierAdapter`):
 *   - a shop-configuration gap (ISO absent, unusable row id) raises the
 *     non-retryable `PrestashopCurrencyUnknownException` - the read succeeded
 *     and reported data the order cannot be denominated with, so every retry
 *     re-reads the same record;
 *   - a failed READ propagates untouched, so the client's `PrestashopApiException`
 *     keeps its status code and its retries. The two must never be conflated.
 *
 * Mirrors the sibling `PrestashopCountryResolver`, which has always refused an
 * ISO the shop does not carry rather than substituting an id.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Injectable, Logger } from '@nestjs/common';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopCurrencyUnknownException } from '../../domain/exceptions/prestashop-currency-unknown.exception';
import { readPrestashopCurrencyByIso } from './prestashop-currency-read';

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
 *
 * Only RESOLVED ids are cached. A refusal is never cached, so an operator who
 * adds the missing currency in the back office is picked up by the next attempt.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class PrestashopCurrencyResolver {
  private readonly logger = new Logger(PrestashopCurrencyResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve ISO 4217 currency code to PrestaShop currency ID
   *
   * Queries PrestaShop currencies by ISO code, caches the result per connection.
   *
   * @param isoCode - ISO 4217 currency code (e.g., 'PLN', 'EUR', 'USD')
   * @param connectionId - Connection ID for cache key
   * @param webserviceClient - PrestaShop WebService client
   * @returns PrestaShop currency ID
   * @throws PrestashopCurrencyUnknownException when the shop has no currency row
   *   for the ISO code, or the matching row's id is unusable (non-retryable)
   * @throws PrestashopApiException when the `GET /currencies` read itself fails
   *   (retryable - raised by the WebService client and propagated unchanged)
   */
  async resolveCurrencyId(
    isoCode: string,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<number> {
    // Normalize ISO code (uppercase, trim)
    const normalizedIso = isoCode.trim().toUpperCase();

    // Defence in depth: the sole production caller
    // (`PrestashopOrderProcessorManagerAdapter.createOrder`, Step 0) already
    // refuses an empty currency before it reaches here, and its message - the
    // one an operator actually sees - leads with the order reference rather
    // than with this one. Kept so a future caller cannot reintroduce the gap.
    if (normalizedIso === '') {
      throw new PrestashopCurrencyUnknownException(
        'Currency missing - the order carries no ISO 4217 currency code, so no ' +
          'PrestaShop currency can be resolved. No order was created.',
        undefined,
        connectionId
      );
    }

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

    // Query PrestaShop currencies through the shared ISO read
    // (`prestashop-currency-read`) so the filter shape lives in one place.
    // Deliberately NOT wrapped in a try/catch: a read failure is a different
    // failure kind from an unresolvable currency and must keep the retryable
    // `PrestashopApiException` the client raises.
    const currency = await readPrestashopCurrencyByIso(webserviceClient, normalizedIso);

    if (!currency) {
      this.logger.error(
        `Currency not configured in PrestaShop: ${normalizedIso} (connection: ${connectionId})`
      );
      throw new PrestashopCurrencyUnknownException(
        `Currency ${normalizedIso} unknown in PrestaShop - the shop has no ` +
          `currency for that code. No order was created; add ${normalizedIso} in ` +
          `PrestaShop (International > Locations > Currencies), then retry.`,
        normalizedIso,
        connectionId
      );
    }

    // Extract currency ID from the matched row
    const currencyId = Number.parseInt(currency.id, 10);

    // Not just `NaN`: `Number.parseInt('0', 10)` is `0` and
    // `Number.parseInt('12abc', 10)` is `12`, neither of which addresses a
    // PrestaShop currency row. A `0` in particular used to survive every guard
    // and then get rewritten to `1` by the mapper's `||` fallback (#2139).
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      this.logger.error(
        `Invalid currency ID returned from PrestaShop: ${currency.id} for ISO: ${normalizedIso} (connection: ${connectionId})`
      );
      throw new PrestashopCurrencyUnknownException(
        `Currency ${normalizedIso} unknown in PrestaShop - its currency row has ` +
          `an unusable id "${currency.id}". No order was created; check the ` +
          `currency in PrestaShop, then retry.`,
        normalizedIso,
        connectionId
      );
    }

    // Cache result with timestamp
    this.cache.set(cacheKey, {
      currencyId,
      timestamp: Date.now(),
    });
    this.logger.debug(`Resolved currency ID: ${normalizedIso} → ${currencyId}`);

    return currencyId;
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
