/**
 * Offer Status Snapshot Domain Entity
 *
 * Represents the persisted, periodically-refreshed marketplace publication
 * status of an offer mapped to an internal variant (#816). This is the
 * steady-state counterpart to `OfferCreationRecord` (which tracks the
 * one-shot creation lifecycle): the snapshot is long-lived and re-read on a
 * schedule so operators can see when an offer goes `ended` / `inactive`
 * without opening each listing.
 *
 * Pure domain object — no framework or persistence concerns.
 *
 * @module libs/core/src/listings/domain/entities
 * @see {@link OfferStatusSnapshotProps} for the property shape
 */
import type {
  OfferStatusSnapshotProps,
  OfferStatusSnapshotDetails,
} from '../types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../types/offer-status-read.types';

export class OfferStatusSnapshot {
  readonly id: string;
  readonly connectionId: string;
  readonly externalOfferId: string;
  readonly internalVariantId: string;
  readonly publicationStatus: OfferPublicationStatus;
  readonly statusDetails: OfferStatusSnapshotDetails | null;
  readonly lastStatusSyncedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: OfferStatusSnapshotProps) {
    this.id = props.id;
    this.connectionId = props.connectionId;
    this.externalOfferId = props.externalOfferId;
    this.internalVariantId = props.internalVariantId;
    this.publicationStatus = props.publicationStatus;
    this.statusDetails = props.statusDetails;
    this.lastStatusSyncedAt = props.lastStatusSyncedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
