/**
 * Offer Commercial Snapshot Types
 *
 * Type definitions for the persisted, periodically-refreshed channel-side
 * price/currency/available-quantity of a mapped offer (#2024). Mirrors
 * `offer-status-snapshot.types.ts` (#816) — the sibling steady-state snapshot
 * this table sits alongside, written by the very same `marketplace.offer.statusSync`
 * pass so no second per-offer HTTP call is introduced.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Persisted snapshot of a mapped offer's live marketplace price + available
 * quantity. Keyed by `(connectionId, externalOfferId)`; `internalVariantId` is
 * carried for reverse navigation to the OL variant.
 */
export interface OfferCommercialSnapshotProps {
  id: string;
  connectionId: string;
  /** Marketplace-native offer id (e.g. Allegro `7781562863`). */
  externalOfferId: string;
  /** Internal OL variant id this offer is mapped to. */
  internalVariantId: string;
  /** Decimal string, e.g. `"99.99"` — keep precision intact across the wire. */
  price: string;
  /** ISO 4217 code. */
  currency: string;
  availableQuantity: number;
  /** When the price/quantity was last read from the marketplace. */
  lastCommercialSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upsert command for a single offer's commercial observation. The repository
 * inserts a new row or updates the existing `(connectionId, externalOfferId)`
 * row, always refreshing `lastCommercialSyncedAt`.
 */
export interface UpsertOfferCommercialSnapshotCommand {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  price: string;
  currency: string;
  availableQuantity: number;
  lastCommercialSyncedAt: Date;
}
