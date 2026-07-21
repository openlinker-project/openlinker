/**
 * PrestaShop Shop-Default-Currency Resolver
 *
 * Resolves the ISO 4217 code of a PrestaShop shop's **default** currency for a
 * connection. PrestaShop stores the default as the `PS_CURRENCY_DEFAULT`
 * configuration value (a currency id); this resolver reads that id, then reads
 * `/currencies/{id}` for its `iso_code`.
 *
 * The result is a per-connection constant (a shop rarely changes its default
 * currency), so it is cached once per connection with a 24h TTL — mirroring the
 * companion `PrestashopFeatureResolver` / `PrestashopCurrencyResolver`. The
 * master sync resolves the adapter per product, so this resolver must be held on
 * the process-singleton factory for its cache to survive across product jobs.
 *
 * Robust by design: any failure (missing/malformed config, ambiguous result,
 * WS error) returns `null` and never throws into product sync — the mapper then
 * emits `currency: null`, today's behaviour before a currency is configured.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  PrestashopConfiguration,
  PrestashopCurrency,
} from './prestashop-provisioner.types';

/** The PrestaShop configuration key holding the shop's default currency id. */
const DEFAULT_CURRENCY_CONFIG_KEY = 'PS_CURRENCY_DEFAULT';

/**
 * Cache TTL (24h). The shop default currency changes rarely, but the cache
 * expires so a back-office change eventually surfaces without a restart.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  /** Resolved default ISO, or `null` when resolution failed / was absent. */
  iso: string | null;
  timestamp: number;
}

export class PrestashopShopCurrencyResolver {
  private readonly logger = new Logger(PrestashopShopCurrencyResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve the shop's default-currency ISO code for a connection.
   *
   * @param connectionId - Cache key
   * @param client - PrestaShop WebService client for this connection
   * @returns The default ISO 4217 code (e.g. `'PLN'`), or `null` on any failure.
   */
  async resolveDefaultCurrencyIso(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<string | null> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.iso;
      }
      this.cache.delete(connectionId);
    }

    const iso = await this.fetchDefaultCurrencyIso(connectionId, client);
    this.cache.set(connectionId, { iso, timestamp: Date.now() });
    return iso;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      this.cache.delete(connectionId);
    } else {
      this.cache.clear();
    }
  }

  private async fetchDefaultCurrencyIso(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<string | null> {
    try {
      const configs = await client.listResources<PrestashopConfiguration>(
        'configurations',
        { custom: { name: DEFAULT_CURRENCY_CONFIG_KEY } },
        1,
        0
      );
      const currencyId = configs?.[0]?.value?.trim();
      if (!currencyId) {
        this.logger.warn(
          `No ${DEFAULT_CURRENCY_CONFIG_KEY} configured in PrestaShop (connection: ${connectionId}); ` +
            `product currency stays null`
        );
        return null;
      }

      const currency = await client.getResource<PrestashopCurrency>('currencies', currencyId);
      const iso = currency?.iso_code?.trim().toUpperCase();
      if (!iso) {
        this.logger.warn(
          `Default currency ${currencyId} has no iso_code in PrestaShop (connection: ${connectionId}); ` +
            `product currency stays null`
        );
        return null;
      }

      this.logger.debug(
        `Resolved PrestaShop default currency for connection ${connectionId}: ${iso}`
      );
      return iso;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve PrestaShop default currency (connection: ${connectionId}); ` +
          `product currency stays null: ${(error as Error).message}`
      );
      return null;
    }
  }
}
