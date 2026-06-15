/**
 * PrestaShop Attribute Resolver (#1050)
 *
 * Builds a `product_option_value` id → `{ groupName, valueName }` lookup so the
 * product mapper can emit semantic variant attributes (`{ Color: 'Red' }`)
 * instead of positional `{ option_0: '15' }` ids — matching the WooCommerce
 * shape so attribute mapping (#1038) has a single neutral input across sources.
 *
 * PrestaShop combinations reference option values by **id only**; the human
 * names live on `/product_options` (groups) + `/product_option_values` (values).
 * Both are a tiny, near-static set, so the resolver fetches the full set **once
 * per connection per TTL** and caches it — not per product. The master sync
 * resolves the adapter per product/job, so this resolver must be held on the
 * process-singleton factory for its cache to survive across product jobs.
 *
 * Localization reuses the product mapper's battle-tested parser (passed in as
 * `localize`) rather than re-implementing PS's flat/JSON/XML field shapes here.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  PrestashopProductOption,
  PrestashopProductOptionValue,
  ResolvedOptionValue,
  LocalizeFn,
} from '../../domain/types/prestashop-product-option.types';

interface CacheEntry {
  map: Map<string, ResolvedOptionValue>;
  timestamp: number;
}

/**
 * Cache TTL (24h). Option groups/values change rarely, but the cache expires so
 * configuration edits in PrestaShop admin eventually surface without a restart.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class PrestashopAttributeResolver {
  private readonly logger = new Logger(PrestashopAttributeResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve (and cache) the option-value id → semantic-name map for a connection.
   *
   * Fetches `/product_options` + `/product_option_values` once per connection
   * per TTL. Values whose group or own name can't be localized are omitted (the
   * mapper falls back to the positional id for those).
   *
   * @param connectionId - Cache key
   * @param client - PrestaShop WebService client for this connection
   * @param localize - Localized-field reader (the product mapper's `localizeField`)
   * @param langId - Preferred language ID (default: 1)
   */
  async getOptionValueMap(
    connectionId: string,
    client: IPrestashopWebserviceClient,
    localize: LocalizeFn,
    langId = 1
  ): Promise<Map<string, ResolvedOptionValue>> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.map;
      }
      this.cache.delete(connectionId);
    }

    // Field-selection keeps this per-connection bootstrap lean — we only read
    // id/name (+ id_attribute_group for values), not full option bodies. Uses
    // the same `display` override `listExternalIds` relies on.
    const [options, values] = await Promise.all([
      client.listResources<PrestashopProductOption>('product_options', {
        display: '[id,name]',
      }),
      client.listResources<PrestashopProductOptionValue>('product_option_values', {
        display: '[id,name,id_attribute_group]',
      }),
    ]);

    const groupNameById = new Map<string, string>();
    for (const option of options ?? []) {
      const name = localize(option.name, langId);
      if (name) {
        groupNameById.set(String(option.id), name);
      }
    }

    const map = new Map<string, ResolvedOptionValue>();
    for (const value of values ?? []) {
      const valueName = localize(value.name, langId);
      const groupId = value.id_attribute_group;
      const groupName = groupId !== undefined ? groupNameById.get(String(groupId)) : undefined;
      if (valueName && groupName) {
        map.set(String(value.id), { groupName, valueName });
      }
    }

    this.cache.set(connectionId, { map, timestamp: Date.now() });
    this.logger.debug(
      `Built option-value map for connection ${connectionId}: ${map.size} resolvable values`
    );
    return map;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      this.cache.delete(connectionId);
    } else {
      this.cache.clear();
    }
  }
}
