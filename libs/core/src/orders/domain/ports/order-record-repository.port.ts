/**
 * Order Record Repository Port
 *
 * Defines the contract for order record persistence operations.
 * This port interface specifies the persistence methods needed by application
 * services, without exposing infrastructure details (TypeORM, database, etc.).
 *
 * @module libs/core/src/orders/domain/ports
 */
import { OrderRecord } from '../entities/order-record.entity';
import type { OrderRecordFilters, OrderRecordPagination, PaginatedOrderRecords } from '../types/order-record.types';
import type { SyncAttempt } from '../types/order-sync.types';

export interface OrderRecordRepositoryPort {
  /**
   * Find order record by internal order ID
   */
  findById(internalOrderId: string): Promise<OrderRecord | null>;

  /**
   * Upsert order record (create or update)
   * Uses internalOrderId as the primary key
   */
  upsert(orderRecord: OrderRecord): Promise<OrderRecord>;

  /**
   * Update sync status for a destination connection.
   *
   * Atomically (single SQL statement):
   *   1. upserts the per-destination row in `syncStatus` (current state),
   *   2. appends `attempt` to `syncAttempts`, keeping at most the documented
   *      per-destination cap of most-recent entries.
   *
   * Throws `OrderRecordNotFoundException` if no row matches `internalOrderId`.
   */
  updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderRecord['syncStatus'][0],
    attempt: SyncAttempt,
  ): Promise<void>;

  /**
   * Find order records with filters and pagination
   */
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination,
  ): Promise<PaginatedOrderRecords>;
}
