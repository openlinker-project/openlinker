/**
 * Order Record Repository Port
 *
 * Defines the contract for order record persistence operations.
 * This port interface specifies the persistence methods needed by application
 * services, without exposing infrastructure details (TypeORM, database, etc.).
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderRecord } from '../entities/order-record.entity';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
  OrderHealthSummary,
  OrderHealthSummaryFilters,
  OrderRecordStatus,
} from '../types/order-record.types';
import type { OrderSlaSummary } from '../types/order-sla.types';
import type { FulfillmentRollupState } from '../types/order-fulfillment.types';
import type { SyncAttempt } from '../types/order-sync.types';

export interface OrderRecordRepositoryPort {
  /**
   * Find order record by internal order ID
   */
  findById(internalOrderId: string): Promise<OrderRecord | null>;

  /**
   * Batch-find order records by internal order ID (#1995).
   *
   * A single query scoped to the given id set — the real batch a cross-context
   * list join (Shipments, Invoices) needs, as opposed to a de-duplicated
   * `Promise.all` fan-out over {@link findById}. Ids with no matching row are
   * silently omitted from the result (never throws, never pads with nulls);
   * callers join back onto their own rows via a `Map` keyed by
   * `internalOrderId`. Returns `[]` immediately for an empty `internalOrderIds`
   * input, without issuing a query.
   */
  findByIds(internalOrderIds: string[]): Promise<OrderRecord[]>;

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
    attempt: SyncAttempt
  ): Promise<void>;

  /**
   * Find order records with filters and pagination
   */
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords>;

  /**
   * Count order records per derived health bucket (#929).
   *
   * Single aggregate query partitioning every record in scope into exactly one
   * bucket using the canonical precedence on `OrderHealthValues`. The returned
   * `total` equals the sum of the four buckets. Scope is the source/customer/
   * date subset only — `health` itself is intentionally not a valid input.
   */
  countByHealth(filters: OrderHealthSummaryFilters): Promise<OrderHealthSummary>;

  /**
   * Count order records per ship-by SLA bucket (#1108) for the list KPI strip.
   * Same scope subset + partition semantics as {@link countByHealth}; encodes
   * the {@link SlaState} precedence (incl. cleared-once-shipped) against the
   * server clock.
   */
  countBySla(filters: OrderHealthSummaryFilters): Promise<OrderSlaSummary>;

  /**
   * Push a per-order fulfillment rollup (#1108) onto the order record. Called
   * from the shipping context after a shipment-status change (best-effort
   * projection). Idempotent absolute-set; a missing order row is a no-op (never
   * throws) so it can't fail the shipment operation.
   */
  updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void>;

  /**
   * Push the honest item-resolution-failure state onto the order record
   * (#1689) — either the ordinary, self-healing `'awaiting_mapping'` gap or
   * the permanently-unresolvable `'source_deleted'` state, with the
   * operator-facing reason. Narrow absolute-set (no read-modify-write),
   * mirroring {@link updateFulfillmentState}. No-op (no throw) when the order
   * row doesn't exist — the ingestion flow always persists the incoming
   * snapshot before item resolution runs, so this should never happen in
   * practice; it's a defensive guard, not an expected path.
   */
  updateItemResolutionFailure(
    internalOrderId: string,
    input: { status: OrderRecordStatus; reason: string }
  ): Promise<void>;

  /**
   * Durably record the instant the source reported this order cancelled
   * (#1984), directly from `handleSourceCancellation` — the one ingestion
   * path that never calls `persistOrder`/`persistIncomingSnapshot`.
   * First-write-wins (`COALESCE`): a redelivered cancel event or a later
   * re-poll can never overwrite an already-recorded cancellation instant.
   * No-op (no throw) when the order row doesn't exist yet — mirrors
   * {@link updateFulfillmentState}'s residual-race tolerance (#1160: a cancel
   * event racing ahead of the order's own create/sync job).
   */
  markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void>;
}
