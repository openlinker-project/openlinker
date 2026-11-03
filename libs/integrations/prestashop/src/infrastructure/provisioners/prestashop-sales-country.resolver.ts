/**
 * PrestaShop Sales-Country Resolver (ADR-077)
 *
 * The product master reports GROSS catalogue prices, and "gross" needs a
 * country: PrestaShop keys tax on the buyer's address. This resolves the one
 * country a connection's catalogue prices are stated for:
 *
 * 1. the connection setting `salesCountryIso2`, when the operator set one;
 * 2. otherwise the shop's own `PS_COUNTRY_DEFAULT`.
 *
 * It also reads `PS_TAX`, because a shop with taxes switched off charges the
 * net price to everyone - gross equals net there, and no tax rule is needed.
 *
 * Failure vocabulary, deliberately split:
 * - a country that does not exist (or is inactive) in the shop, or a missing
 *   `PS_COUNTRY_DEFAULT`, is a CONFIGURATION answer: `null`, logged, cached
 *   briefly so an operator's fix shows up within a minute. The product master
 *   then reports no price - never a net one.
 * - a failed call to PrestaShop throws, so the sync job retries and the
 *   stored product row is left untouched rather than blanked.
 *
 * The first rung of the fallback is not cosmetic: a stock docker install of
 * PrestaShop defaults to the United States, under which the shop itself prices
 * every product without Polish VAT. The product master's gate catches that
 * (no rule for the country), but only an operator can say which country the
 * catalogue is for.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopApiException } from '../../domain/exceptions/prestashop-api.exception';
import { PrestashopCountryNotFoundException } from '../../domain/exceptions/prestashop-country-not-found.exception';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopCountryResolver } from './prestashop-country-resolver';
import type { PrestashopConfiguration } from './prestashop-provisioner.types';
import type { PrestashopSalesCountry } from './prestashop-sales-country.types';

const DEFAULT_COUNTRY_CONFIG_KEY = 'PS_COUNTRY_DEFAULT';
const TAX_ENABLED_CONFIG_KEY = 'PS_TAX';

/** A resolved answer changes only when an operator changes the shop or the setting. */
const CACHE_TTL_MS = 60 * 60 * 1000;
/** A configuration gap is re-checked quickly so a fix is not hidden for an hour. */
const UNRESOLVED_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  value: PrestashopSalesCountry | null;
  ttlMs: number;
  timestamp: number;
}

interface PrestashopCountryRow {
  id?: string | number;
  iso_code?: string;
}

export class PrestashopSalesCountryResolver {
  private readonly logger = new Logger(PrestashopSalesCountryResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly countryResolver: PrestashopCountryResolver) {}

  /**
   * @param connectionId - Cache key (with the configured ISO)
   * @param configuredIso2 - `config.salesCountryIso2`, if the operator set one
   * @param client - WebService client for this connection
   * @returns The sales country, or `null` when the shop cannot name one
   * @throws PrestashopApiException when PrestaShop could not be read
   */
  async resolve(
    connectionId: string,
    configuredIso2: string | undefined,
    client: IPrestashopWebserviceClient
  ): Promise<PrestashopSalesCountry | null> {
    const configured = configuredIso2?.trim().toUpperCase() || undefined;
    const cacheKey = `${connectionId}:${configured ?? '-'}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.timestamp < cached.ttlMs) {
      return cached.value;
    }

    const value = await this.read(connectionId, configured, client);
    this.cache.set(cacheKey, {
      value,
      ttlMs: value === null ? UNRESOLVED_CACHE_TTL_MS : CACHE_TTL_MS,
      timestamp: Date.now(),
    });
    return value;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${connectionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private async read(
    connectionId: string,
    configured: string | undefined,
    client: IPrestashopWebserviceClient
  ): Promise<PrestashopSalesCountry | null> {
    // One read for both keys: an array custom filter is a pipe-joined OR list.
    // NOTE (multistore): like `PS_CURRENCY_DEFAULT` in the shop-currency
    // resolver, these keys can carry per-shop rows; the first row wins.
    const configs = await client.listResources<PrestashopConfiguration>(
      'configurations',
      { custom: { name: [DEFAULT_COUNTRY_CONFIG_KEY, TAX_ENABLED_CONFIG_KEY] } },
      10,
      0
    );
    const valueOf = (key: string): string | undefined =>
      configs?.find((c) => c.name === key)?.value?.trim() || undefined;
    // PrestaShop treats an absent `PS_TAX` as enabled; only an explicit `0`
    // switches taxes off.
    const taxesEnabled = valueOf(TAX_ENABLED_CONFIG_KEY) !== '0';

    if (configured !== undefined) {
      try {
        const countryId = await this.countryResolver.resolveCountryId(
          configured,
          connectionId,
          client
        );
        return { countryId, iso2: configured, source: 'setting', taxesEnabled };
      } catch (error) {
        if (error instanceof PrestashopCountryNotFoundException) {
          this.logger.warn(
            `prestashop_sales_country_unresolved - connection ${connectionId}: the sales country ` +
              `'${configured}' set on the connection does not exist or is inactive in the shop; ` +
              `catalogue prices are reported as unavailable until it is fixed`
          );
          return null;
        }
        throw error;
      }
    }

    const defaultId = Number.parseInt(valueOf(DEFAULT_COUNTRY_CONFIG_KEY) ?? '', 10);
    if (!Number.isFinite(defaultId) || defaultId <= 0) {
      this.logger.warn(
        `prestashop_sales_country_unresolved - connection ${connectionId}: no sales country is ` +
          `set on the connection and the shop has no ${DEFAULT_COUNTRY_CONFIG_KEY}; catalogue ` +
          `prices are reported as unavailable until one is set`
      );
      return null;
    }

    let country: PrestashopCountryRow | undefined;
    try {
      country = await client.getResource<PrestashopCountryRow>('countries', defaultId);
    } catch (error) {
      if (error instanceof PrestashopApiException && error.statusCode === 404) {
        country = undefined;
      } else {
        throw error;
      }
    }
    const iso2 = country?.iso_code?.trim().toUpperCase();
    if (!iso2) {
      this.logger.warn(
        `prestashop_sales_country_unresolved - connection ${connectionId}: ` +
          `${DEFAULT_COUNTRY_CONFIG_KEY}=${defaultId} names no readable country; catalogue prices ` +
          `are reported as unavailable until a sales country is set on the connection`
      );
      return null;
    }
    return { countryId: defaultId, iso2, source: 'shop-default', taxesEnabled };
  }
}
