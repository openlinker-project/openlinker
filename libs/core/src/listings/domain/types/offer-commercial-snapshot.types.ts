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
 * tell apart from a genuine sell-out. An observation that carries neither axis
 * is not written at all - see `UpsertOfferCommercialSnapshotCommand`.
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
  /** ISO 4217 code; `null` when the price is absent or carried no currency. */
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
 * row, always refreshing `lastCommercialSyncedAt` - so the caller must only
 * issue the command for an observation that carries something to record.
 *
 * A read carrying EITHER axis is written, `null` on the other: a good quantity
 * must not be discarded because the price was missing. A read carrying NEITHER
 * is not issued at all, because the upsert overwrites every field: it would
 * blank a previously-good row and simultaneously stamp it as freshly synced,
 * so the operator reads "no data, synced a minute ago" when the truth is
 * "34.90, synced two days ago". Leaving the prior row untouched keeps its
 * timestamp correctly ageing, which is the honest signal.
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

/**
 * Outcome of one attempted commercial write, tallied by the status-sync service
 * into `OfferStatusSyncResult.commercialUpdated` / `commercialFailed`. Without
 * a job-level counter a systematically failing write (code deployed ahead of
 * the migration, a column/permission mismatch) is visible only as one warn line
 * per offer next to an `outcome: 'ok'` job record.
 *
 * `skipped` is a genuine third state (no observation at all, or one carrying
 * neither axis) that maps to NEITHER counter, which is why this is not a
 * boolean. Deliberately kept off the listings barrel: it is the return type of
 * one private method, not something a sibling context consumes.
 */
export type OfferCommercialWriteOutcome = 'written' | 'skipped' | 'failed';
