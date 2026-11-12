/**
 * Shopify Shop Context Provider
 *
 * The shop-wide facts every capability adapter needs: the shop currency,
 * whether catalogue prices include tax (ADR-077 needs a GROSS price, so a
 * tax-exclusive shop must be told apart), and the ONE location OpenLinker
 * reads and writes stock at.
 *
 * Location: the connection's `config.locationId` when set - refused, naming
 * the field, when the shop does not list it (K06: an unknown id used to pass
 * and only the stock sync failed); otherwise the shop's primary location
 * (`QueryRoot.location` with no `id`, verified live on 2026-10), falling back
 * to the first active location.
 *
 * One request, memoised per instance and carried between the per-call adapter
 * bags by the host cache for a few minutes. The cached value records the
 * configured location it was resolved for, so a config change is seen at once.
 *
 * @module libs/integrations/shopify/src/infrastructure/shop-context
 */
import type { CachePort } from '@openlinker/shared';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { shopifyShopContextCacheKey } from '../../domain/policies/shopify-credentials.policy';
import type {
  ShopifyConnection,
  ShopifyLocationNode,
  ShopifyShopInfo,
} from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';

const CACHE_TTL_SECONDS = 600;

export interface ShopifyShopContext {
  readonly shopName: string;
  readonly currencyCode: string;
  readonly taxesIncluded: boolean;
  /** GID and name of the single location OpenLinker works against. */
  readonly locationGid: string;
  readonly locationName: string;
}

interface CachedShopContext extends ShopifyShopContext {
  readonly configuredLocationGid: string | null;
}

interface ShopContextQuery {
  readonly shop: ShopifyShopInfo;
  readonly location: ShopifyLocationNode | null;
  readonly locations: ShopifyConnection<ShopifyLocationNode>;
}

export const SHOPIFY_SHOP_CONTEXT_QUERY = `query OlShopContext {
  shop { id name myshopifyDomain currencyCode taxesIncluded }
  location { id name isActive }
  locations(first: 250) { nodes { id name isActive } }
}`;

export class ShopifyShopContextProvider {
  private read: Promise<ShopifyShopContext> | null = null;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
    private readonly configuredLocationGid: string | null,
    private readonly cache: CachePort | undefined,
  ) {}

  get(): Promise<ShopifyShopContext> {
    if (this.read === null) {
      this.read = this.load().catch((error: unknown) => {
        this.read = null;
        throw error;
      });
    }
    return this.read;
  }

  private async load(): Promise<ShopifyShopContext> {
    const key = shopifyShopContextCacheKey(this.connectionId);
    if (this.cache !== undefined) {
      const cached = await this.cache.get<CachedShopContext>(key).catch(() => null);
      if (cached !== null && cached.configuredLocationGid === this.configuredLocationGid) {
        return stripCacheFields(cached);
      }
    }
    const data = await this.client.query<ShopContextQuery>(SHOPIFY_SHOP_CONTEXT_QUERY);
    const location = this.resolveLocation(data);
    const context: ShopifyShopContext = {
      shopName: data.shop.name,
      currencyCode: data.shop.currencyCode,
      taxesIncluded: data.shop.taxesIncluded,
      locationGid: location.id,
      locationName: location.name,
    };
    if (this.cache !== undefined) {
      const entry: CachedShopContext = { ...context, configuredLocationGid: this.configuredLocationGid };
      await this.cache.set(key, entry, CACHE_TTL_SECONDS).catch(() => undefined);
    }
    return context;
  }

  private resolveLocation(data: ShopContextQuery): ShopifyLocationNode {
    if (this.configuredLocationGid !== null) {
      const known = data.locations.nodes.find((l) => l.id === this.configuredLocationGid);
      if (known === undefined) {
        throw new ShopifyConfigException(
          this.connectionId,
          `locationId ${this.configuredLocationGid} is not one of the shop's locations`,
          'locationId',
        );
      }
      if (!known.isActive) {
        throw new ShopifyConfigException(
          this.connectionId,
          `locationId ${this.configuredLocationGid} (${known.name}) is not an active location`,
          'locationId',
        );
      }
      return known;
    }
    if (data.location !== null && data.location.isActive) {
      return data.location;
    }
    const firstActive = data.locations.nodes.find((l) => l.isActive);
    if (firstActive === undefined) {
      throw new ShopifyConfigException(this.connectionId, 'the shop has no active location');
    }
    return firstActive;
  }
}

function stripCacheFields(cached: CachedShopContext): ShopifyShopContext {
  return {
    shopName: cached.shopName,
    currencyCode: cached.currencyCode,
    taxesIncluded: cached.taxesIncluded,
    locationGid: cached.locationGid,
    locationName: cached.locationName,
  };
}
