/**
 * Shop Status Sync Service Interface (#1845)
 *
 * Contract for the steady-state shop product-status reconcile: read the live
 * shop-side publication status of published products for a connection and
 * persist it into `shop_product_status_snapshots`. Enumeration is paged via a
 * numeric scan offset over the connection's published/draft listing records; the
 * caller (worker handler) persists `nextOffset` for the next run. The shop-side
 * sibling of `IOfferStatusSyncService`.
 *
 * @module libs/core/src/listings/application/services
 */
import type { ShopStatusSyncResult } from '../../domain/types/shop-product-status.types';

export interface ShopStatusSyncOptions {
  /** Page size: number of published/draft records to reconcile this run. */
  limit: number;
  /** Scan offset into the connection's published/draft records. Defaults to 0. */
  offset?: number;
}

export type { ShopStatusSyncResult };

export interface IShopStatusSyncService {
  /**
   * Reconcile and persist the shop-side publication status of one page of the
   * connection's published/draft products. Returns counters plus `nextOffset`
   * (wraps to 0 at the end of the set). Connections whose adapter does not
   * support `ShopProductStatusReader` are skipped with a zeroed result.
   */
  sync(connectionId: string, options: ShopStatusSyncOptions): Promise<ShopStatusSyncResult>;
}
