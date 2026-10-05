/**
 * PrestaShop Shop-Units Resolver
 *
 * Resolves the shop's weight and dimension units (`PS_WEIGHT_UNIT`,
 * `PS_DIMENSION_UNIT` in the webservice `configurations` resource) for a
 * connection, so product weight/size can be converted to grams / millimetres
 * (#3650).
 *
 * Cached per connection above the adapter (the factory holds one instance for
 * the plugin lifetime, like `PrestashopShopCurrencyResolver`), so the per-product
 * adapters a master sweep builds never issue a request per product. A resolved
 * answer is cached for an hour; an unresolved one for ten minutes (see
 * `UNRESOLVED_CACHE_TTL_MS`).
 *
 * Never throws: any failure yields `null` units, which the mapper reads as
 * "not recorded" - physical data is enrichment and must not break product sync.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopShopUnits } from '../mappers/prestashop-physical-data';
import type { PrestashopConfiguration } from './prestashop-provisioner.types';

const WEIGHT_UNIT_KEY = 'PS_WEIGHT_UNIT';
const DIMENSION_UNIT_KEY = 'PS_DIMENSION_UNIT';

const CACHE_TTL_MS = 60 * 60 * 1000;
// Shorter than the resolved TTL so a blip or a not-yet-configured shop does
// not pin "unknown" for an hour after it is fixed - ten minutes still recovers
// promptly. Not shorter, because a shop with neither unit configured is a
// permanent condition: every expiry costs two `configurations` reads against
// that shop's rate limit for an answer that will not change, and this bounds
// that steady-state cost.
const UNRESOLVED_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  units: PrestashopShopUnits | null;
  ttlMs: number;
  timestamp: number;
}

export class PrestashopShopUnitsResolver {
  private readonly logger = new Logger(PrestashopShopUnitsResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * @returns The shop units, or `null` when neither unit could be read.
   */
  async resolveUnits(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<PrestashopShopUnits | null> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return cached.units;
      }
      this.cache.delete(connectionId);
    }

    const units = await this.fetchUnits(connectionId, client);
    this.cache.set(connectionId, {
      units,
      ttlMs: units === null ? UNRESOLVED_CACHE_TTL_MS : CACHE_TTL_MS,
      timestamp: Date.now(),
    });
    return units;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      this.cache.delete(connectionId);
    } else {
      this.cache.clear();
    }
  }

  private async fetchUnits(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<PrestashopShopUnits | null> {
    try {
      const [weightUnit, dimensionUnit] = await Promise.all([
        this.readConfiguration(client, WEIGHT_UNIT_KEY),
        this.readConfiguration(client, DIMENSION_UNIT_KEY),
      ]);
      if (weightUnit === null && dimensionUnit === null) {
        this.logger.warn(
          `Neither ${WEIGHT_UNIT_KEY} nor ${DIMENSION_UNIT_KEY} is configured in PrestaShop ` +
            `(connection: ${connectionId}); variant weight and dimensions stay unrecorded`
        );
        return null;
      }
      return { weightUnit, dimensionUnit };
    } catch (error) {
      this.logger.warn(
        `Failed to read PrestaShop weight/dimension units (connection: ${connectionId}); ` +
          `variant weight and dimensions stay unrecorded: ${(error as Error).message}`
      );
      return null;
    }
  }

  private async readConfiguration(
    client: IPrestashopWebserviceClient,
    name: string
  ): Promise<string | null> {
    const rows = await client.listResources<PrestashopConfiguration>(
      'configurations',
      { custom: { name } },
      1,
      0
    );
    const value = rows?.[0]?.value?.trim();
    return value ? value : null;
  }
}
