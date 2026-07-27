/**
 * Shop Product Status Snapshot Repository Port (#1845)
 *
 * Persistence contract for `shop_product_status_snapshots` rows - the
 * periodically-refreshed shop-side publication status of published products.
 * The shop-side sibling of `OfferStatusSnapshotRepositoryPort`. Intentionally
 * minimal: the steady-state status sync needs only a keyed read, an upsert, and
 * a per-status count.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { ShopProductStatusSnapshot } from '../entities/shop-product-status-snapshot.entity';
import type {
  ShopPublicationStatus,
  UpsertShopProductStatusSnapshotCommand,
} from '../types/shop-product-status.types';

/**
 * Result of {@link ShopProductStatusSnapshotRepositoryPort.upsert}. Carries the
 * persisted snapshot plus the publication status the row held BEFORE this write
 * (`null` on first insert) so the caller can detect a transition without a
 * second read.
 */
export interface ShopProductStatusUpsertResult {
  snapshot: ShopProductStatusSnapshot;
  previousStatus: ShopPublicationStatus | null;
}

export interface ShopProductStatusSnapshotRepositoryPort {
  /**
   * Look up the snapshot for a `(connectionId, externalProductId)` pair.
   * Returns `null` when the product has never been reconciled.
   */
  findByConnectionAndExternalProductId(
    connectionId: string,
    externalProductId: string,
  ): Promise<ShopProductStatusSnapshot | null>;

  /**
   * Insert a new snapshot or update the existing `(connectionId,
   * externalProductId)` row, always refreshing `lastStatusSyncedAt`. Returns the
   * persisted snapshot plus the row's previous publication status (`null` on
   * first insert). Safe under the single-writer-per-connection sync (cursor
   * advances sequentially; a same-key race resolves to an update on retry).
   */
  upsert(
    command: UpsertShopProductStatusSnapshotCommand,
  ): Promise<ShopProductStatusUpsertResult>;

  /**
   * Count snapshots for a connection grouped by publication status. Keys with
   * zero snapshots are omitted. For observability / future status dashboards.
   */
  countByConnectionAndStatus(
    connectionId: string,
  ): Promise<Map<ShopPublicationStatus, number>>;

  /**
   * List snapshots for a set of internal variant ids, optionally scoped to a
   * single connection. Backs a future operator-facing per-product shop-status
   * read. An empty id list returns `[]` without querying.
   */
  findByVariantIds(
    internalVariantIds: string[],
    connectionId?: string,
  ): Promise<ShopProductStatusSnapshot[]>;
}
