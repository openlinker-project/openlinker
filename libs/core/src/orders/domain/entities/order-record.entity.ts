/**
 * Order Record Domain Entity
 *
 * Represents a persisted order record in OpenLinker. Stores minimal order data
 * (OrderRecord + SyncState) for retry/debug support without re-polling source systems.
 * Order snapshot is PII-aware (respects OL_STORE_PII configuration).
 *
 * @module libs/core/src/orders/domain/entities
 */

/**
 * Sync status for a destination connection
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
 * Order Record Domain Entity
 *
 * Stores minimal order data for retry/debug support. Order snapshot contains
 * the full order data (PII-aware), and syncStatus tracks sync state per destination.
 */
export class OrderRecord {
  constructor(
    public readonly internalOrderId: string,
    public readonly customerId: string | null,
    public readonly sourceConnectionId: string,
    public readonly sourceEventId: string | null,
    public readonly orderSnapshot: Record<string, unknown>,
    public readonly syncStatus: OrderSyncStatus[],
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
