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
 *
 * **These values are what the MARKETPLACE reports, not what OL intended to
 * publish.** The quantity is therefore already net of the connection's
 * `stockSafetyBuffer` (#1844 - the channel sees `max(0, masterStock - reserve)`)
 * and the price is already the output of the connection's `pricingRule` (#1843
 * - markup/margin/rounding applied over the master catalogue price). A constant
 * delta against master stock or master price is the expected, correctly
 * configured behaviour, not a sync defect. Surface these as "on channel", never
 * as OL's own stock/price.
 *
 * `price`/`currency` and `availableQuantity` are independently nullable: a
 * sparse marketplace response must not persist `0`, which an operator cannot
 * tell apart from a genuine sell-out.
 */
export interface OfferCommercialSnapshotProps {
  id: string;
  connectionId: string;
  /** Marketplace-native offer id (e.g. Allegro `7781562863`). */
  externalOfferId: string;
  /** Internal OL variant id this offer is mapped to. */
  internalVariantId: string;
  /**
   * Decimal string, e.g. `"99.99"` - keep precision intact across the wire.
   * `null` when the marketplace reported no price.
   */
  price: string | null;
  /** ISO 4217 code; `null` whenever `price` is `null`. */
  currency: string | null;
  /** `null` when the marketplace reported no quantity - never `0` by default. */
  availableQuantity: number | null;
  /** When the price/quantity was last read from the marketplace. */
  lastCommercialSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upsert command for a single offer's commercial observation. The repository
 * inserts a new row or updates the existing `(connectionId, externalOfferId)`
 * row, always refreshing `lastCommercialSyncedAt` - the row is written whenever
 * the marketplace read succeeded, even if it carried no price or no quantity,
 * so the freshness stamp never overstates or understates what was observed.
 */
export interface UpsertOfferCommercialSnapshotCommand {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  price: string | null;
  currency: string | null;
  availableQuantity: number | null;
  lastCommercialSyncedAt: Date;
}
