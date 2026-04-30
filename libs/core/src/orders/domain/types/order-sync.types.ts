/**
 * Order Sync Types
 *
 * Per-destination sync state and append-only attempt history for an
 * `OrderRecord`. `OrderSyncStatus` is one row per destination (current
 * state); `SyncAttempt` is an append-only log entry capped per destination
 * so the activity timeline can render `failed → retried → synced` history
 * after a successful retry overwrites the current state.
 *
 * @module domain/types
 */

/**
 * Current sync state for one destination connection.
 *
 * Stored as a JSONB array on `order_records.syncStatus`, one entry per
 * destination, upserted in place by the repository.
 */
export interface OrderSyncStatus {
  /** Destination connection ID */
  destinationConnectionId: string;
  /** Sync status: pending, syncing, synced, or failed */
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Timestamp when sync completed (for synced status) */
  syncedAt?: Date;
  /** External order ID in destination system */
  externalOrderId?: string;
  /** External order number in destination system */
  externalOrderNumber?: string;
  /** Error message (for failed status) */
  error?: string;
}

/**
 * One historical attempt to sync an order to a destination.
 *
 * Stored as a JSONB array on `order_records.syncAttempts`, append-only,
 * per-destination cap of {@link SYNC_ATTEMPTS_PER_DESTINATION_CAP}. Unlike
 * `OrderSyncStatus`, every entry carries a real `attemptedAt` timestamp
 * (no "in progress" placeholder) so the activity timeline can sort and
 * render every attempt deterministically.
 */
export interface SyncAttempt {
  destinationConnectionId: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  attemptedAt: Date;
  error?: string;
  externalOrderId?: string;
  externalOrderNumber?: string;
}

/**
 * Maximum number of attempts retained per destination on `syncAttempts`.
 *
 * Single source of truth — the repository binds this into the SQL window
 * function and the FE compares against it to decide whether to render
 * the "view all attempts" deep link to `/sync/jobs`. The hand-written FE
 * mirror lives in `apps/web/src/features/orders/api/orders.types.ts`;
 * keep both in sync per the FE-001 contract strategy.
 */
export const SYNC_ATTEMPTS_PER_DESTINATION_CAP = 20;
