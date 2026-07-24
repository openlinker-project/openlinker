/**
 * Shop Product Status Types (#1845)
 *
 * Neutral observation + persistence contract for reconciling the live shop-side
 * publication status of a previously-published product. The shop-side sibling of
 * `offer-status-read.types.ts` + `offer-status-snapshot.types.ts`.
 *
 * The publication-status union covers the states a shop can report for a product
 * OL published: still live, reverted to draft, unpublished (present but not
 * buyer-visible), or removed/trashed (gone shop-side). Adapters map their native
 * status vocabulary (WooCommerce `publish|draft|pending|private|trash`, a 404,
 * …) onto this neutral union.
 *
 * Persistence note: the reconciled status is stored on `shop_product_status_snapshots`.
 * A removed/renamed member of this union would need a data migration for that
 * table; adding a member stays additive.
 *
 * @module libs/core/src/listings/domain/types
 */

export const ShopPublicationStatusValues = [
  'published',
  'draft',
  'unpublished',
  'removed',
] as const;
export type ShopPublicationStatus = (typeof ShopPublicationStatusValues)[number];

/**
 * Named-constant map for the shop publication status (mirrors
 * `LISTING_CREATION_STATUS` / `OFFER_CREATION_STATUS`).
 */
export const SHOP_PUBLICATION_STATUS = {
  Published: 'published',
  Draft: 'draft',
  Unpublished: 'unpublished',
  Removed: 'removed',
} as const satisfies Record<Capitalize<ShopPublicationStatus>, ShopPublicationStatus>;

/**
 * Neutral observation returned by `ShopProductStatusReader.getShopProductStatus`.
 * Adapters report the shop-side state only; OL record lifecycle is owned by the
 * application service.
 */
export interface ShopProductStatusReadResult {
  publicationStatus: ShopPublicationStatus;
}

/**
 * Platform-neutral detail blob persisted with a snapshot. Kept loose (a string
 * list) so adapters can attach human-readable context without the snapshot
 * contract growing platform-specific fields.
 */
export interface ShopProductStatusSnapshotDetails {
  messages?: string[];
}

/**
 * Persisted snapshot of a published product's live shop-side status. Keyed by
 * `(connectionId, externalProductId)`; `internalVariantId` is carried for
 * reverse navigation to the OL variant.
 */
export interface ShopProductStatusSnapshotProps {
  id: string;
  connectionId: string;
  /** Shop-native product id (e.g. WooCommerce `123`). */
  externalProductId: string;
  /** Internal OL variant id this product is mapped to. */
  internalVariantId: string;
  /** Last observed shop publication status. */
  publicationStatus: ShopPublicationStatus;
  /** Optional opaque platform detail captured alongside the status. Null when none. */
  statusDetails: ShopProductStatusSnapshotDetails | null;
  /** When the status was last read from the shop. */
  lastStatusSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upsert command for a single product's status observation. The repository
 * inserts or updates the existing `(connectionId, externalProductId)` row,
 * always refreshing `lastStatusSyncedAt`.
 */
export interface UpsertShopProductStatusSnapshotCommand {
  connectionId: string;
  externalProductId: string;
  internalVariantId: string;
  publicationStatus: ShopPublicationStatus;
  statusDetails: ShopProductStatusSnapshotDetails | null;
  lastStatusSyncedAt: Date;
}

/**
 * Result of one `shop.product.statusSync` run for a connection.
 */
export interface ShopStatusSyncResult {
  /** Published/draft records examined this run (<= page limit). */
  scanned: number;
  /** Snapshots inserted or updated. */
  updated: number;
  /** Products whose status changed versus the prior snapshot. */
  transitioned: number;
  /** Products the shop reported as removed/trashed (or 404). */
  removed: number;
  /** Total published/draft records for the connection (for offset wrap-around). */
  total: number;
  /** Scan offset to persist for the next run (wraps to 0 at set end). */
  nextOffset: number;
}
