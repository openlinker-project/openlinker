/**
 * Order Record Service Interface
 *
 * Defines the contract for order record persistence operations.
 * This interface specifies the methods needed for persisting order records
 * with PII-aware snapshot handling and sync status tracking.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import { Order } from '../../domain/ports/order-source.port';
import { OrderRecord, OrderSyncStatus } from '../../domain/entities/order-record.entity';

export interface IOrderRecordService {
  /**
   * Persist order record with PII-aware snapshot
   *
   * Creates a snapshot of the order that respects OL_STORE_PII configuration.
   * If PII storage is disabled, sensitive fields (email, names, addresses) are
   * nulled out in the snapshot.
   *
   * @param order - Unified order with internal IDs
   * @param sourceConnectionId - Source connection ID (where order originated)
   * @param sourceEventId - Optional source event ID
   * @returns Persisted order record
   */
  persistOrder(
    order: Order,
    sourceConnectionId: string,
    sourceEventId: string | null,
  ): Promise<OrderRecord>;

  /**
   * Update sync status for a destination
   *
   * Updates the sync status for a specific destination connection after
   * order sync completes (successfully or with error).
   *
   * @param internalOrderId - Internal order ID
   * @param destinationConnectionId - Destination connection ID
   * @param status - Sync status
   */
  updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus,
  ): Promise<void>;

  /**
   * Get order record by ID
   *
   * Retrieves a persisted order record for retry/debug purposes.
   *
   * @param internalOrderId - Internal order ID
   * @returns Order record or null if not found
   */
  getOrderRecord(internalOrderId: string): Promise<OrderRecord | null>;
}
