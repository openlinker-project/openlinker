/**
 * Offer Quantity Write-Order Types
 *
 * Vocabulary and the pure rule that decides which of two concurrent quantity
 * writes for one offer is allowed to reach the marketplace (#2617).
 *
 * The `realtime` lane runs jobs concurrently and promises nothing about the
 * order in which two writes for the same offer complete, so an older quantity
 * can land last and leave the listing advertising stale stock. The rule here is
 * the tiebreak: a write carries the observation it was derived from, and an
 * observation no newer than the last one already written is refused.
 *
 * PRECONDITION: the observation token comes from ONE clock. Today it is
 * `inventory_items.updatedAt`, which #2071 made database-stamped and read back
 * via RETURNING, so cross-process skew does not exist and the only ambiguity is
 * two writes inside the same millisecond, which the rule lets through. If the
 * stamp is ever replaced by a worker-side `new Date()`, a process running ahead
 * would refuse a genuinely later write and leave the channel stale - worse than
 * the last-write-wins this guard replaced. Keep the stamp in the database.
 *
 * @module libs/core/src/inventory/domain/types
 */

/**
 * How long one offer's quantity write may hold its serialisation lock.
 *
 * Covers a single marketplace call plus the mark advance. Kept short: expiry is
 * not a correctness cliff, it only re-opens the window this guard narrows.
 */
export const OFFER_QUANTITY_WRITE_LOCK_TTL_MS = 30_000;

/**
 * Serialisation key for one offer's quantity write.
 *
 * Keyed per (connection, offer) rather than per offer: the same external offer
 * id can belong to two connections (an Erli `externalOfferId` IS the internal
 * variant id, shared by every Erli connection), and writes to two different
 * marketplaces are not in conflict.
 */
export function offerQuantityWriteLockKey(connectionId: string, offerId: string): string {
  return `inventory:offerQuantity:${connectionId}:${offerId}`;
}

/**
 * Cursor key holding the newest observation successfully written for one offer.
 *
 * Stored per connection in the ordinary connection-cursor store, so the mark is
 * durable across restarts and shared by every worker replica with no new table.
 *
 * `offerId` also carries a `ShopProduct` external id on the shop write-back
 * branch, which is safe because the cursor namespace is per connection and a
 * connection carries only one mapping kind, so the two id spaces cannot meet.
 *
 * Rows are never deleted: one small row per mapped target per connection, kept
 * even after the mapping is gone. An accepted leak, bounded by target count.
 */
export function offerQuantityObservationCursorKey(offerId: string): string {
  return `inventory.offerQuantity.observedAt:offer:${offerId}`;
}

/**
 * May `candidate` be written, given the last observation already written?
 *
 * Only a STRICTLY OLDER observation is refused. Three cases deliberately pass.
 * No mark means nothing was ever written under the guard. An equal observation
 * is a retry of the same write, which is idempotent, and two observations that
 * cannot be told apart give no reason to prefer the earlier arrival. An
 * unparseable value on either side passes too: a guard that cannot compare must
 * degrade to the pre-#2617 last-write-wins behaviour rather than refuse a write
 * and leave the channel stale.
 */
export function isWritableQuantityObservation(
  candidate: string,
  lastWritten: string | null
): boolean {
  if (lastWritten === null) {
    return true;
  }
  const candidateMs = Date.parse(candidate);
  const lastMs = Date.parse(lastWritten);
  if (Number.isNaN(candidateMs) || Number.isNaN(lastMs)) {
    return true;
  }
  return candidateMs >= lastMs;
}
