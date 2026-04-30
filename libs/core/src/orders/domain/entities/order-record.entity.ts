/**
 * Order Record Domain Entity
 *
 * Represents a persisted order record in OpenLinker. Stores minimal order data
 * (OrderRecord + SyncState) for retry/debug support without re-polling source systems.
 * Order snapshot is PII-aware (respects OL_STORE_PII configuration).
 *
 * @module domain/entities
 */
import type { OrderRecordStatus } from '../types/order-record.types';
import type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';

export type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';

/**
 * Order Record Domain Entity
 *
 * Stores minimal order data for retry/debug support. Order snapshot contains
 * the full order data (PII-aware), and syncStatus tracks sync state per destination.
 *
 * recordStatus='awaiting_mapping': snapshot holds raw IncomingOrder (external refs, no internal IDs).
 * recordStatus='ready': snapshot holds resolved Order (internal product/variant IDs).
 *
 * `syncAttempts` is the per-destination append-only history; the constructor
 * defaults it to `[]` so existing call sites that pre-date the column compile
 * unchanged (the field is hydrated from the JSONB column by the repository).
 */
export class OrderRecord {
  constructor(
    public readonly internalOrderId: string,
    public readonly customerId: string | null,
    public readonly sourceConnectionId: string,
    public readonly sourceEventId: string | null,
    public readonly orderSnapshot: Record<string, unknown>,
    public readonly syncStatus: OrderSyncStatus[],
    public readonly recordStatus: OrderRecordStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly syncAttempts: SyncAttempt[] = [],
  ) {}
}
