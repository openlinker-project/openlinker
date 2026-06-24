/**
 * PrestaShop Feature Resolver (#1096 F2)
 *
 * Builds the lookups that turn a product's raw feature references
 * (`{ featureId, featureValueId }`, parsed by `PrestashopProductMapper`) into
 * semantic `{ name, value }` pairs (e.g. `{ name: 'Material', value: 'Ceramic' }`)
 * — the neutral shop-attribute shape a borrows destination (Erli) emits as
 * `externalAttributes` `source:"shop"`.
 *
 * PrestaShop products reference features by **id only**; the human names live on
 * `/product_features` (groups) + `/product_feature_values` (values). Both are a
 * tiny, near-static set, so the resolver fetches the full set **once per
 * connection per TTL** and caches it — not per product. The master sync resolves
 * the adapter per product/job, so this resolver must be held on the
 * process-singleton factory for its cache to survive across product jobs (mirrors
 * `PrestashopAttributeResolver`).
 *
 * Localization reuses the product mapper's battle-tested parser (passed in as
 * `localize`) rather than re-implementing PS's flat/JSON/XML field shapes here.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  PrestashopProductFeature,
  PrestashopProductFeatureValue,
  LocalizeFn,
} from '../../domain/types/prestashop-product-option.types';

/** A feature group name (`featureId` → name) + value (`featureValueId` → value) lookup. */
export interface FeatureLookups {
  /** `id_feature` → feature group name (e.g. "Material"). */
  nameById: Map<string, string>;
  /** `id_feature_value` → value (e.g. "Ceramic"). */
  valueById: Map<string, string>;
}

interface CacheEntry {
  lookups: FeatureLookups;
  timestamp: number;
}

/**
 * Cache TTL (24h). Feature groups/values change rarely, but the cache expires so
 * configuration edits in PrestaShop admin eventually surface without a restart.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class PrestashopFeatureResolver {
  private readonly logger = new Logger(PrestashopFeatureResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve (and cache) the feature lookups for a connection.
   *
   * Fetches `/product_features` + `/product_feature_values` once per connection
   * per TTL. Entries whose name/value can't be localized are omitted (the caller
   * then drops that feature ref).
   *
   * @param connectionId - Cache key
   * @param client - PrestaShop WebService client for this connection
   * @param localize - Localized-field reader (the product mapper's `localizeField`)
   * @param langId - Preferred language ID (default: 1)
   */
  async getFeatureLookups(
    connectionId: string,
    client: IPrestashopWebserviceClient,
    localize: LocalizeFn,
    langId = 1
  ): Promise<FeatureLookups> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.lookups;
      }
      this.cache.delete(connectionId);
    }

    // Field-selection keeps this per-connection bootstrap lean — we only read the
    // id/name (groups) and id/value (values), not full bodies.
    const [features, values] = await Promise.all([
      client.listResources<PrestashopProductFeature>('product_features', {
        display: '[id,name]',
      }),
      client.listResources<PrestashopProductFeatureValue>('product_feature_values', {
        display: '[id,value]',
      }),
    ]);

    const nameById = new Map<string, string>();
    for (const feature of features ?? []) {
      const name = localize(feature.name, langId);
      if (name) {
        nameById.set(String(feature.id), name);
      }
    }

    const valueById = new Map<string, string>();
    for (const value of values ?? []) {
      const valueName = localize(value.value, langId);
      if (valueName) {
        valueById.set(String(value.id), valueName);
      }
    }

    const lookups: FeatureLookups = { nameById, valueById };
    this.cache.set(connectionId, { lookups, timestamp: Date.now() });
    this.logger.debug(
      `Built feature lookups for connection ${connectionId}: ${nameById.size} features, ${valueById.size} values`
    );
    return lookups;
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
