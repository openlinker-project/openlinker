/**
 * PrestaShop Pack Resolver
 *
 * Answers two shop-level questions the inventory adapter needs per pack: which
 * product ids are packs at all, and what `PS_PACK_STOCK_TYPE` the shop is set
 * to.
 *
 * Both live here rather than on the adapter because master inventory sync builds
 * one adapter per product (#2592 hoisted the factory into the plugin closure, so
 * a cache held here really does outlive a job). Without the id set the adapter
 * had to read `products/{id}` for EVERY simple product just to learn whether it
 * was a pack - roughly +100% requests on the inventory sweep, since most
 * products are not packs. One paged `cache_is_pack` read per connection per TTL
 * replaces that.
 *
 * `null` is the answer for "could not resolve", never an empty set: an empty set
 * would classify every pack as an ordinary product and keep publishing its
 * permanently stale own stock row, which is the overselling #2598 exists to
 * stop. The adapter treats `null` as "no pack knowledge" and degrades to the
 * pre-#2598 behaviour instead of probing every product.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import {
  PRESTASHOP_UNNARROWED_MAX_PAGES,
  readAllPrestashopPages,
} from '../http/prestashop-paged-read';

/** The PrestaShop configuration key holding the shop-wide pack stock type. */
const PACK_STOCK_TYPE_CONFIG_KEY = 'PS_PACK_STOCK_TYPE';

/**
 * Cache TTL (10 min). Creating a pack is a back-office action, so the set is
 * near-static, but a new pack must not oversell for long: inside the TTL it is
 * classified as an ordinary product and keeps reporting its own row. Ten minutes
 * is under the 15-minute inventory sweep cadence, so at most one cycle sees a
 * brand-new pack as ordinary.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Short TTL (60s) for an unresolved answer. A read blip or a webservice key
 * without `products` permission must not pin "no pack knowledge" for ten
 * minutes once the operator has fixed it.
 */
const UNRESOLVED_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry<T> {
  value: T;
  ttlMs: number;
  timestamp: number;
}

export class PrestashopPackResolver {
  private readonly logger = new Logger(PrestashopPackResolver.name);
  private readonly packIdCache = new Map<string, CacheEntry<Set<string> | null>>();
  private readonly shopStockTypeCache = new Map<string, CacheEntry<number | null>>();

  /**
   * The shop's pack product ids, or `null` when they could not be resolved.
   */
  async resolvePackIds(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<Set<string> | null> {
    return this.readCached(this.packIdCache, connectionId, () =>
      this.fetchPackIds(connectionId, client)
    );
  }

  /**
   * The shop-wide `PS_PACK_STOCK_TYPE`, or `null` when it could not be read.
   */
  async resolveShopPackStockType(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<number | null> {
    return this.readCached(this.shopStockTypeCache, connectionId, () =>
      this.fetchShopPackStockType(connectionId, client)
    );
  }

  /** Clear the caches for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      this.packIdCache.delete(connectionId);
      this.shopStockTypeCache.delete(connectionId);
      return;
    }
    this.packIdCache.clear();
    this.shopStockTypeCache.clear();
  }

  private async readCached<T>(
    cache: Map<string, CacheEntry<T | null>>,
    connectionId: string,
    fetch: () => Promise<T | null>
  ): Promise<T | null> {
    const cached = cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return cached.value;
      }
      cache.delete(connectionId);
    }

    const value = await fetch();
    cache.set(connectionId, {
      value,
      // The TTL keys on the answer being unresolved at all, so no negative entry
      // outlives the operator fixing what caused it.
      ttlMs: value === null ? UNRESOLVED_CACHE_TTL_MS : CACHE_TTL_MS,
      timestamp: Date.now(),
    });
    return value;
  }

  private async fetchPackIds(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<Set<string> | null> {
    try {
      // Paged, and paged loudly: a shop can hold more than one page of packs,
      // and a pack missing from a truncated list would be read as an ordinary
      // product and keep selling off its stale own row - the same false answer
      // one level up from the truncated component read (#2608).
      const rows = await readAllPrestashopPages<{ id?: string | number }>(
        (limit, offset) =>
          client.listResources<{ id?: string | number }>(
            'products',
            { display: '[id]', custom: { cache_is_pack: 1 } },
            limit,
            offset
          ),
        {
          resource: 'products',
          connectionId,
          // A shop-wide enumeration, so the wider budget applies: a very large
          // catalogue can legitimately hold many packs.
          maxPages: PRESTASHOP_UNNARROWED_MAX_PAGES,
          detail: 'cache_is_pack=1',
        }
      );

      const packIds = new Set<string>();
      for (const row of rows) {
        const id = row.id;
        if (typeof id === 'number' ? Number.isFinite(id) : typeof id === 'string' && id !== '') {
          packIds.add(String(id).trim());
        }
      }

      this.logger.debug(
        `master_inventory_pack_ids_resolved connection=${connectionId} packs=${packIds.size}`
      );
      return packIds;
    } catch (error) {
      // Logged once per connection per short TTL rather than once per product,
      // which is what a missing `products` read permission used to produce.
      this.logger.warn(
        `master_inventory_pack_ids_unresolved connection=${connectionId} - pack quantities will be reported from each pack own stock row: ${(error as Error).message}`
      );
      return null;
    }
  }

  private async fetchShopPackStockType(
    connectionId: string,
    client: IPrestashopWebserviceClient
  ): Promise<number | null> {
    try {
      // One page is the whole answer: `name` is unique in `configurations`.
      const rows = await client.listResources<{ value?: string | number }>(
        'configurations',
        { custom: { name: PACK_STOCK_TYPE_CONFIG_KEY } },
        1,
        0
      );
      const raw = rows.length > 0 ? rows[0].value : undefined;
      const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      this.logger.warn(
        `master_inventory_pack_shop_default_unreadable connection=${connectionId} - ${PACK_STOCK_TYPE_CONFIG_KEY} could not be read: ${(error as Error).message}`
      );
      return null;
    }
  }
}
