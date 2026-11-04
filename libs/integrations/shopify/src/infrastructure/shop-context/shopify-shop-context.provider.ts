/**
 * Shopify Shop Context Provider
 *
 * The shop-wide facts the mappers need: the shop currency, whether catalogue
 * prices include tax (ADR-077 needs a GROSS price, so a tax-exclusive shop
 * reports no price rather than a net one), and the ONE location OpenLinker
 * reads and writes stock at.
 *
 * Location: the connection's `config.locationId` when set; otherwise the
 * shop's primary location. `QueryRoot.location` with no `id` returns the
 * primary location on API 2026-10 (verified live: `isPrimary: true`), and the
 * first active location from `locations` is the fallback should that ever
 * answer null. OpenLinker runs as a single warehouse until multi-location
 * support arrives with a WMS, so every other location is out of scope.
 *
 * One request (`shop` + `location`), memoised per instance and carried between
 * the per-call adapter bags by the host cache for a few minutes: the location
 * a connection works against must not be re-resolved on every job.
 *
 * @module libs/integrations/shopify/src/infrastructure/shop-context
 */
import type { CachePort } from '@openlinker/shared';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import type { ShopifyConnection, ShopifyShopInfo } from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';

const CACHE_TTL_SECONDS = 600;

export interface ShopifyShopContext {
  readonly currencyCode: string;
  readonly taxesIncluded: boolean;
  /** GID of the single location OpenLinker works against. */
  readonly locationGid: string;
}

interface ShopContextQuery {
  readonly shop: ShopifyShopInfo;
  readonly location: { readonly id: string; readonly isActive: boolean } | null;
  readonly locations: ShopifyConnection<{ readonly id: string; readonly isActive: boolean }>;
}

const SHOP_CONTEXT_QUERY = `query OlShopContext {
  shop { name currencyCode taxesIncluded }
  location { id isActive }
  locations(first: 50) { nodes { id isActive } }
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

  private get cacheKey(): string {
    return `shopify:shop-context:${this.connectionId}:${this.configuredLocationGid ?? 'primary'}`;
  }

  private async load(): Promise<ShopifyShopContext> {
    if (this.cache !== undefined) {
      const cached = await this.cache.get<ShopifyShopContext>(this.cacheKey).catch(() => null);
      if (cached !== null) {
        return cached;
      }
    }
    const data = await this.client.query<ShopContextQuery>(SHOP_CONTEXT_QUERY);
    const locationGid = this.resolveLocation(data);
    const context: ShopifyShopContext = {
      currencyCode: data.shop.currencyCode,
      taxesIncluded: data.shop.taxesIncluded,
      locationGid,
    };
    if (this.cache !== undefined) {
      await this.cache.set(this.cacheKey, context, CACHE_TTL_SECONDS).catch(() => undefined);
    }
    return context;
  }

  private resolveLocation(data: ShopContextQuery): string {
    if (this.configuredLocationGid !== null) {
      const known = data.locations.nodes.find((l) => l.id === this.configuredLocationGid);
      // A configured id the shop does not list is a misconfiguration: reading
      // it would report every variant as out of stock.
      if (known === undefined) {
        throw new ShopifyConfigException(
          this.connectionId,
          `locationId ${this.configuredLocationGid} is not one of the shop's locations`,
        );
      }
      return known.id;
    }
    if (data.location !== null && data.location.isActive) {
      return data.location.id;
    }
    const firstActive = data.locations.nodes.find((l) => l.isActive);
    if (firstActive === undefined) {
      throw new ShopifyConfigException(this.connectionId, 'the shop has no active location');
    }
    return firstActive.id;
  }
}
