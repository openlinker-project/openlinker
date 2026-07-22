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

/**
 * Short TTL (60s) for a transient-failure `null`. A network blip / 5xx during
 * the first product sync must NOT pin `currency: null` for the whole 24h TTL —
 * the next sync re-attempts within a minute. A *definitive* resolution (a real
 * ISO, or a genuinely absent `PS_CURRENCY_DEFAULT`) still caches for the full
 * `CACHE_TTL_MS`.
 */
const FAILURE_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  /** Resolved default ISO, or `null` when resolution failed / was absent. */
  iso: string | null;
  /** Per-entry TTL; short for transient failures, full for definitive results. */
  ttlMs: number;
  timestamp: number;
}

/** Distinguishes a definitive resolution from a transient-failure `null`. */
interface ResolutionResult {
  iso: string | null;
  /** `true` when `iso === null` came from a transient error (short TTL). */
  transient: boolean;
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
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return cached.iso;
      }
      this.cache.delete(connectionId);
    }

    const { iso, transient } = await this.fetchDefaultCurrencyIso(connectionId, client);
    this.cache.set(connectionId, {
      iso,
      ttlMs: transient ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS,
      timestamp: Date.now(),
    });
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
  ): Promise<ResolutionResult> {
    try {
      // NOTE (multistore): on a multistore PrestaShop, `PS_CURRENCY_DEFAULT`
      // can carry per-shop / per-shop-group rows. `limit=1` here takes an
      // arbitrary one, which can mislabel the currency for the shop the
      // connection's products actually come from. Correct for the common
      // single-store case; shop-scoping this read is a documented follow-up.
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
        // Definitive absence — cache for the full TTL.
        return { iso: null, transient: false };
      }

      const currency = await client.getResource<PrestashopCurrency>('currencies', currencyId);
      const iso = currency?.iso_code?.trim().toUpperCase();
      if (!iso) {
        this.logger.warn(
          `Default currency ${currencyId} has no iso_code in PrestaShop (connection: ${connectionId}); ` +
            `product currency stays null`
        );
        // Definitive (malformed data, not a transient blip) — full TTL.
        return { iso: null, transient: false };
      }

      this.logger.debug(
        `Resolved PrestaShop default currency for connection ${connectionId}: ${iso}`
      );
      return { iso, transient: false };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve PrestaShop default currency (connection: ${connectionId}); ` +
          `product currency stays null: ${(error as Error).message}`
      );
      // Transient failure (WS timeout / 5xx) — short TTL so the next sync retries.
      return { iso: null, transient: true };
    }
  }
}
