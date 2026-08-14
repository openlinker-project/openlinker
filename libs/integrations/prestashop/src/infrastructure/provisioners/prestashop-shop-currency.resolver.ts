/**
 * PrestaShop Shop-Default-Currency Resolver
 *
 * Resolves the ISO 4217 code of a PrestaShop shop's **default** currency for a
 * connection. PrestaShop stores the default as the `PS_CURRENCY_DEFAULT`
 * configuration value (a currency id); this resolver reads that id, then reads
 * `/currencies/{id}` for its `iso_code`.
 *
 * A RESOLVED result is a per-connection constant (a shop rarely changes its
 * default currency), so it is cached once per connection with a 24h TTL —
 * mirroring the companion `PrestashopFeatureResolver` /
 * `PrestashopCurrencyResolver`. An UNRESOLVED result is cached for 60s only, so
 * neither a read blip nor a missing `PS_CURRENCY_DEFAULT` survives the operator
 * fixing it (see `UNRESOLVED_CACHE_TTL_MS`). The master sync resolves the adapter
 * per product, so this resolver must be held on the process-singleton factory for
 * its cache to survive across product jobs.
 *
 * Robust by design: any failure (missing/malformed config, ambiguous result,
 * WS error) returns `null` and never throws into product sync — the mapper then
 * emits `currency: null`, today's behaviour before a currency is configured.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopConfiguration, PrestashopCurrency } from './prestashop-provisioner.types';
import type { PrestashopShopCurrencyResolution } from './prestashop-shop-currency.types';

/** The PrestaShop configuration key holding the shop's default currency id. */
const DEFAULT_CURRENCY_CONFIG_KEY = 'PS_CURRENCY_DEFAULT';

/**
 * Cache TTL (24h). The shop default currency changes rarely, but the cache
 * expires so a back-office change eventually surfaces without a restart.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Short TTL (60s) for ANY unresolved (`null`) answer — a transient read failure
 * and a definitive absence alike. A network blip / 5xx during the first product
 * sync must not pin `currency: null` for the whole 24h TTL, and neither must a
 * missing `PS_CURRENCY_DEFAULT`: since #2102 a second consumer turns the same
 * `null` into an order REFUSAL whose message tells the operator to configure the
 * default currency and retry, and a 24h negative entry would keep refusing for a
 * day after they did. Only a resolved ISO caches for the full `CACHE_TTL_MS`.
 */
const UNRESOLVED_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  /** Resolved default ISO, or `null` when resolution failed / was absent. */
  iso: string | null;
  /**
   * Whether a cached `null` came from a failed read. Cached alongside the value
   * so a cache HIT reports the same transient/definitive verdict a fresh read
   * would - a caller that turns the verdict into a retry decision (#2102) must
   * not get a different answer just because it arrived within the TTL.
   */
  transient: boolean;
  /** Per-entry TTL; short for any unresolved answer, full for a resolved ISO. */
  ttlMs: number;
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
    const { iso } = await this.resolveDefaultCurrency(connectionId, client);
    return iso;
  }

  /**
   * Resolve the shop's default-currency ISO code **with the reason** an
   * unresolved read failed.
   *
   * Same cached read as {@link resolveDefaultCurrencyIso} - this is the shape
   * for callers that must branch on why the answer is `null`, because they turn
   * it into a retry decision rather than a `currency: null` projection (#2102).
   *
   * @param connectionId - Cache key
   * @param client - PrestaShop WebService client for this connection
   */
  async resolveDefaultCurrency(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<PrestashopShopCurrencyResolution> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return { iso: cached.iso, transient: cached.transient };
      }
      this.cache.delete(connectionId);
    }

    const { iso, transient } = await this.fetchDefaultCurrencyIso(connectionId, client);
    this.cache.set(connectionId, {
      iso,
      transient,
      // `transient` still carries the RETRY decision (#2102); the TTL keys on the
      // answer being unresolved at all, so no negative entry outlives a fix.
      ttlMs: iso === null ? UNRESOLVED_CACHE_TTL_MS : CACHE_TTL_MS,
      timestamp: Date.now(),
    });
    return { iso, transient };
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
  ): Promise<PrestashopShopCurrencyResolution> {
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
        // Definitive absence (not a blip), so a retry of the same read is
        // pointless — but it is still cached on the SHORT TTL, because the
        // operator can fix it in the back office at any moment.
        return { iso: null, transient: false };
      }

      const currency = await client.getResource<PrestashopCurrency>('currencies', currencyId);
      const iso = currency?.iso_code?.trim().toUpperCase();
      if (!iso) {
        this.logger.warn(
          `Default currency ${currencyId} has no iso_code in PrestaShop (connection: ${connectionId}); ` +
            `product currency stays null`
        );
        // Definitive (malformed data, not a transient blip) — same short TTL as
        // the branch above, for the same reason.
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
