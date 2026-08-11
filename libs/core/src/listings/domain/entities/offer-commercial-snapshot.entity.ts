/**
 * Offer Commercial Snapshot Domain Entity
 *
 * Represents the persisted, periodically-refreshed channel-side price and
 * available quantity of an offer mapped to an internal variant (#2024). Sits
 * alongside `OfferStatusSnapshot` (#816) as the commercial counterpart —
 * written by the same steady-state `marketplace.offer.statusSync` pass, off
 * the same per-offer adapter response, so no additional marketplace call is
 * introduced.
 *
 * Pure domain object — no framework or persistence concerns.
 *
 * @module libs/core/src/listings/domain/entities
 * @see {@link OfferCommercialSnapshotProps} for the property shape
 */
import type { OfferCommercialSnapshotProps } from '../types/offer-commercial-snapshot.types';

export class OfferCommercialSnapshot {
  readonly id: string;
  readonly connectionId: string;
  readonly externalOfferId: string;
  readonly internalVariantId: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly availableQuantity: number | null;
  readonly lastCommercialSyncedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: OfferCommercialSnapshotProps) {
    this.id = props.id;
    this.connectionId = props.connectionId;
    this.externalOfferId = props.externalOfferId;
    this.internalVariantId = props.internalVariantId;
    this.price = props.price;
    this.currency = props.currency;
    this.availableQuantity = props.availableQuantity;
    this.lastCommercialSyncedAt = props.lastCommercialSyncedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
