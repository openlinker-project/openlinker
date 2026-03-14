/**
 * PrestaShop Country Resolver
 *
 * Resolves ISO 3166-1 alpha-2 country codes to PrestaShop country IDs.
 * Caches results per connection to reduce API calls.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Injectable, Logger } from '@nestjs/common';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopCountryNotFoundException } from '../../domain/exceptions/prestashop-country-not-found.exception';
import { PrestashopCountry } from './prestashop-provisioner.types';

/**
 * Cache entry with timestamp for TTL
 */
interface CacheEntry {
  countryId: number;
  timestamp: number;
}

/**
 * Cache TTL in milliseconds (24 hours)
 * Countries are rarely added/changed in PrestaShop, but cache should expire
 * to handle configuration changes.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class PrestashopCountryResolver {
  private readonly logger = new Logger(PrestashopCountryResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve ISO2 country code to PrestaShop country ID
   *
   * Queries PrestaShop countries by ISO code, caches result per connection.
   * Throws PrestashopCountryNotFoundException if country not found.
   *
   * @param iso2Code - ISO 3166-1 alpha-2 country code (e.g., 'PL', 'US')
   * @param connectionId - Connection ID for cache key
   * @param webserviceClient - PrestaShop WebService client
   * @returns PrestaShop country ID
   * @throws PrestashopCountryNotFoundException if country not found
   */
  async resolveCountryId(
    iso2Code: string,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient,
  ): Promise<number> {
    // Normalize ISO2 code (uppercase, trim)
    const normalizedIso2 = iso2Code.trim().toUpperCase();

    // Check cache
    const cacheKey = `${connectionId}:${normalizedIso2}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      // Check if cache entry is still valid (not expired)
      const now = Date.now();
      if (now - cached.timestamp < CACHE_TTL_MS) {
        this.logger.debug(`Country ID cached: ${normalizedIso2} → ${cached.countryId}`);
        return cached.countryId;
      } else {
        // Cache expired, remove entry
        this.cache.delete(cacheKey);
        this.logger.debug(`Cache expired for country: ${normalizedIso2}`);
      }
    }

    // Query PrestaShop countries
    // Note: PrestashopWebserviceClient must generate filter[iso_code]=[PL]&display=[id,active] format
    // We request the active field in the response and filter client-side to avoid double queries
    const countries = await webserviceClient.listResources<PrestashopCountry>(
      'countries',
      {
        custom: { iso_code: normalizedIso2 },
        // Note: display parameter should include 'active' field if supported by PrestaShop WebService
        // If not supported, we'll filter based on what we get
      },
      10, // limit - get more results to find active ones
      0, // offset
    );

    // PrestaShop returns countries in array format
    // Filter for active countries (client-side filtering to avoid double query)
    const activeCountries = countries?.filter((c) => {
      const active = c.active;
      // Handle both string and number formats ('1' or 1 for active)
      // If active field is not in response, assume active (fallback for PrestaShop versions that don't return it)
      return active === undefined || active === '1' || active === 1 || active === 'true';
    }) || [];

    if (activeCountries.length === 0) {
      // Check if any countries were returned (to distinguish between "not found" and "not active")
      if (countries && countries.length > 0) {
        // Country exists but is inactive
        this.logger.error(
          `Country found but not active in PrestaShop: ${normalizedIso2} (connection: ${connectionId}). Please activate the country in PrestaShop admin.`,
        );
        throw new PrestashopCountryNotFoundException(
          `${normalizedIso2} (country exists but is not active)`,
          connectionId,
        );
      }
      
      // Country not found at all
      throw new PrestashopCountryNotFoundException(normalizedIso2, connectionId);
    }

    // Extract country ID from first active result
    const country = activeCountries[0];
    const countryId = Number.parseInt(country.id, 10);

    if (Number.isNaN(countryId)) {
      this.logger.error(
        `Invalid country ID returned from PrestaShop: ${country.id} for ISO2: ${normalizedIso2}`,
      );
      throw new PrestashopCountryNotFoundException(normalizedIso2, connectionId);
    }

    // Cache result with timestamp
    this.cache.set(cacheKey, {
      countryId,
      timestamp: Date.now(),
    });
    this.logger.debug(`Resolved country ID: ${normalizedIso2} → ${countryId}`);

    return countryId;
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
