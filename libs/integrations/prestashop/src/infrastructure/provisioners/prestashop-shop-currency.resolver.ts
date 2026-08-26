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
 * fixing it (see `UNRESOLVED_CACHE_TTL_MS`).
 *
 * In the wiring as it ships, that TTL split is not yet observable: this resolver
 * is a field on `PrestashopAdapterFactory`, and `prestashop-plugin.ts`
 * constructs a new factory per `createCapabilityAdapter`, so the cache is
 * discarded after the single `resolveDefaultCurrencyIso` call each adapter build
 * makes. Every build re-reads regardless of TTL. The short unresolved TTL is
 * kept as a defensive default - it costs nothing while the cache is per-build,
 * and it is the correct value the moment the factory is genuinely held as a
 * process singleton, which the field placement already assumes.
 *
 * Robust by design: any failure (missing/malformed config, ambiguous result,
 * WS error) returns `null` and never throws into product sync — the mapper then
 * emits `currency: null`, today's behaviour before a currency is configured.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { readPrestashopCurrencyById } from './prestashop-currency-read';
import type { PrestashopConfiguration } from './prestashop-provisioner.types';

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
 * missing or malformed `PS_CURRENCY_DEFAULT`: an operator can fix that in the
 * back office at any moment, and a 24h negative entry would keep reporting the
 * old answer for a day after they did. Only a resolved ISO caches for the full
 * `CACHE_TTL_MS`.
 */
const UNRESOLVED_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  /** Resolved default ISO, or `null` when resolution failed / was absent. */
  iso: string | null;
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
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return cached.iso;
      }
      this.cache.delete(connectionId);
    }

    const iso = await this.fetchDefaultCurrencyIso(connectionId, client);
    this.cache.set(connectionId, {
      iso,
      // The TTL keys on the answer being unresolved at all — a read blip and a
      // back-office gap alike — so no negative entry outlives a fix.
      ttlMs: iso === null ? UNRESOLVED_CACHE_TTL_MS : CACHE_TTL_MS,
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
  ): Promise<string | null> {
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
        // Cached on the SHORT TTL: the operator can configure it in the back
        // office at any moment.
        return null;
      }

      const currency = await readPrestashopCurrencyById(client, currencyId);
      const iso = currency?.iso_code?.trim().toUpperCase();
      if (!iso) {
        this.logger.warn(
          `Default currency ${currencyId} has no iso_code in PrestaShop (connection: ${connectionId}); ` +
            `product currency stays null`
        );
        // Same short TTL as the branch above, for the same reason.
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
      // Transient failure (WS timeout / 5xx) — short TTL so the next sync retries.
      return null;
    }
  }
}
