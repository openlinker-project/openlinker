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
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import {
  PRESTASHOP_UNNARROWED_MAX_ROWS,
  readAllPrestashopResourcePages,
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
    load: () => Promise<T | null>
  ): Promise<T | null> {
    const cached = cache.get(connectionId);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < cached.ttlMs) {
        return cached.value;
      }
      cache.delete(connectionId);
    }

    const value = await load();
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
      const rows = await readAllPrestashopResourcePages<{ id?: string | number }>(
        client,
        'products',
        { display: '[id]', custom: { cache_is_pack: 1 } },
        {
          connectionId,
          // A shop-wide enumeration, so the wider budget applies: a very large
          // catalogue can legitimately hold many packs.
          maxRows: PRESTASHOP_UNNARROWED_MAX_ROWS,
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
      // A truncated read is not a degraded answer here, it is the #2598 defect
      // returning: a pack missing from a cut list is classified an ordinary
      // product and publishes its own stale stock row. So it propagates, and
      // the inventory sync fails loudly instead of writing a wrong quantity.
      if (error instanceof PrestashopTruncatedReadException) {
        throw error;
      }

      // Everything else - most often a missing `products` read permission -
      // stays a degraded answer, logged once per connection per short TTL
      // rather than once per product.
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
      // One page is the whole answer, but only because of the limit: on a
      // multistore install `configuration` is keyed by name plus shop group
      // plus shop, so this takes an arbitrary shop's row for the key. Same
      // hazard the currency resolver documents for PS_CURRENCY_DEFAULT.
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
