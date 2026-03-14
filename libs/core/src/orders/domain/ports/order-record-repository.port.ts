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
   * Update sync status for a destination connection
   */
  updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderRecord['syncStatus'][0],
  ): Promise<void>;
}
