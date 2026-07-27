/**
 * Master-Deletion Event Types
 *
 * Platform-neutral domain-event contract published when a product/variant is
 * detected as deleted at its master (#1599). The observability seam: UI /
 * notification consumers are follow-ups, but the event must exist so they can
 * be built without touching the sync services again.
 *
 * Owned by the products context (canonical owner of variant identity) and
 * consumed cross-context by the inventory master-sync prune path — a value
 * import of `UPPER_SNAKE_CASE as const` constants, the permitted cross-context
 * shape. Published as an `EventEnvelope` (inline `eventType`), matching the
 * codebase's runtime event pattern rather than a `*.event.ts` class.
 *
 * Delivery is **at-most-once**: the event is published *after* the stale-mark
 * commits, so a publish failure loses the event and the next sync will NOT
 * re-emit it (the rows are already stale, so the prune returns no new ids). The
 * authoritative state is the persisted `isStale` flag, not the event; a future
 * consumer that needs guaranteed delivery should reconcile against the flag (or
 * this should move to a transactional outbox). Matches the existing
 * fire-after-commit publisher precedent (e.g. `SyncJobBulkRetryService`).
 *
 * @module libs/core/src/products/domain/types
 */

/** Redis stream the master-deletion events are published to. */
export const MASTER_DELETION_EVENT_STREAM = 'events.master.deletion';

/** Emitted when specific variants are marked stale (partial prune). */
export const MASTER_VARIANT_STALE_EVENT = 'master.variant.stale';

/** Emitted when a whole product 404s at the master (all variants marked stale). */
export const MASTER_PRODUCT_STALE_EVENT = 'master.product.stale';

/** Schema version stamped into the event envelope metadata. */
export const MASTER_DELETION_EVENT_SCHEMA_VERSION = '1';

/**
 * Payload carried by both master-deletion events. `variantIds` are the internal
 * OpenLinker variant ids newly marked stale.
 */
export interface MasterDeletionEventPayload {
  connectionId: string;
  internalProductId: string;
  variantIds: string[];
}
