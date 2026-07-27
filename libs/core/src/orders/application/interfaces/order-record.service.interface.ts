/**
 * Order Record Service Interface
 *
 * Defines the contract for order record persistence operations.
 * This interface specifies the methods needed for persisting order records
 * with PII-aware snapshot handling and sync status tracking.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { Order } from '../../domain/types/order.types';
import type { OrderRecord, OrderSyncStatus } from '../../domain/entities/order-record.entity';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
} from '../../domain/types/order-record.types';
import type { FulfillmentRollupState } from '../../domain/types/order-fulfillment.types';

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
   * @param sourceExternalUrl - Optional deep link to the order in the source
   *   platform's UI (#1713), built by the source adapter; persisted onto the
   *   snapshot as `sourceExternalUrl`.
   * @returns Persisted order record
   */
  persistOrder(
    order: Order,
    sourceConnectionId: string,
    sourceEventId: string | null,
    sourceExternalUrl?: string | null
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
    status: OrderSyncStatus
  ): Promise<void>;

  /**
   * Persist raw incoming snapshot before item resolution.
   *
   * Called immediately after ID resolution but before offer→variant mapping.
   * Sets recordStatus='awaiting_mapping'. On retry, once all items resolve,
   * persistOrder() upserts with recordStatus='ready'.
   *
   * The orderSnapshot stores the raw IncomingOrder — items retain external offer
   * refs and do NOT contain internal product/variant IDs.
   */
  persistIncomingSnapshot(
    incoming: IncomingOrder,
    internalOrderId: string,
    customerId: string | null,
    sourceConnectionId: string,
    sourceEventId: string | null
  ): Promise<OrderRecord>;

  /**
   * Get order record by ID
   *
   * Retrieves a persisted order record for retry/debug purposes.
   *
   * @param internalOrderId - Internal order ID
   * @returns Order record or null if not found
   */
  getOrderRecord(internalOrderId: string): Promise<OrderRecord | null>;

  /**
   * Filtered, paginated list of order records (#834). The cross-context
   * surface the shipping branch-1 sync service uses to enumerate
   * destination-matched records — repository ports are forbidden across
   * context boundaries per architecture-overview.md § "Cross-context
   * dependencies in core", so callers go through this service method
   * instead. Delegates to `OrderRecordRepositoryPort.findMany`.
   */
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords>;

  /**
   * Push a per-order fulfillment rollup (#1108) onto the order record. The
   * cross-context surface the shipping context calls after a shipment-status
   * change (`shipping → orders`, via this service — never the repository port).
   * Best-effort/idempotent; a missing order row is a no-op.
   */
  updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void>;
}
