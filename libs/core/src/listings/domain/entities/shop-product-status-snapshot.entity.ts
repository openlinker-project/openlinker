/**
 * Shop Product Status Snapshot Domain Entity (#1845)
 *
 * The persisted, periodically-refreshed shop-side publication status of a
 * product OL published to a shop connection. The shop-side sibling of
 * `OfferStatusSnapshot`: long-lived and re-read on a schedule so operators can
 * see when a product is unpublished / trashed shop-side without opening each
 * storefront listing.
 *
 * Pure domain object - no framework or persistence concerns.
 *
 * @module libs/core/src/listings/domain/entities
 * @see {@link ShopProductStatusSnapshotProps} for the property shape
 */
import type {
  ShopProductStatusSnapshotProps,
  ShopProductStatusSnapshotDetails,
} from '../types/shop-product-status.types';
import type { ShopPublicationStatus } from '../types/shop-product-status.types';

export class ShopProductStatusSnapshot {
  readonly id: string;
  readonly connectionId: string;
  readonly externalProductId: string;
  readonly internalVariantId: string;
  readonly publicationStatus: ShopPublicationStatus;
  readonly statusDetails: ShopProductStatusSnapshotDetails | null;
  readonly lastStatusSyncedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ShopProductStatusSnapshotProps) {
    this.id = props.id;
    this.connectionId = props.connectionId;
    this.externalProductId = props.externalProductId;
    this.internalVariantId = props.internalVariantId;
    this.publicationStatus = props.publicationStatus;
    this.statusDetails = props.statusDetails;
    this.lastStatusSyncedAt = props.lastStatusSyncedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
