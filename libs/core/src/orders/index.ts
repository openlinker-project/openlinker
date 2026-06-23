/**
 * Orders Module Exports
 *
 * Public API for the orders module. Exports ports, types, and domain entities
 * for use by other modules and adapters.
 *
 * @module libs/core/src/orders
 */

// Ports
export { OrderSourcePort } from './domain/ports/order-source.port';
export { OrderProcessorManagerPort } from './domain/ports/order-processor-manager.port';

// Sub-capabilities (#472): optional capabilities extracted into distinct
// interfaces + co-located type guards. Mirrors the pattern established by the
// OfferManagerPort sub-capabilities in @openlinker/core/listings.
export type { DestinationOptionsReader } from './domain/ports/capabilities/destination-options-reader.capability';
export { isDestinationOptionsReader } from './domain/ports/capabilities/destination-options-reader.capability';
export type { SourceOptionsReader } from './domain/ports/capabilities/source-options-reader.capability';
export { isSourceOptionsReader } from './domain/ports/capabilities/source-options-reader.capability';
// Dispatch-notify sub-capabilities (#837): mark-sent on the source + post-create
// fulfillment update on the destination.
export type { OrderDispatchNotifier } from './domain/ports/capabilities/order-dispatch-notifier.capability';
export { isOrderDispatchNotifier } from './domain/ports/capabilities/order-dispatch-notifier.capability';
export type { OrderFulfillmentUpdater } from './domain/ports/capabilities/order-fulfillment-updater.capability';
export { isOrderFulfillmentUpdater } from './domain/ports/capabilities/order-fulfillment-updater.capability';
// Read-back counterpart to OrderFulfillmentUpdater (#834): branch-1
// shipment-status projection from the OMP's view.
export type { FulfillmentStatusReader } from './domain/ports/capabilities/fulfillment-status-reader.capability';
export { isFulfillmentStatusReader } from './domain/ports/capabilities/fulfillment-status-reader.capability';
export type {
  FulfillmentStatus,
  FulfillmentStatusSnapshot,
} from './domain/types/fulfillment-status-snapshot.types';
export {
  FulfillmentStatusValues,
  FULFILLMENT_STATUS,
} from './domain/types/fulfillment-status-snapshot.types';
export type { DispatchCarrierHint } from './domain/types/dispatch-carrier-hint.types';
export type { MappingOption, MappingOptionKind } from './domain/types/mapping-option.types';
export { MappingOptionKindValues } from './domain/types/mapping-option.types';

// Types
export {
  OrderFilters,
  OrderStatus,
  OrderStatusValues,
  Order,
  OrderItem,
  OrderTotals,
  PriceTaxTreatment,
  PriceTaxTreatmentValues,
  Address,
  OrderShipping,
  OrderPickupPoint,
  OrderDispatchWindow,
} from './domain/types/order.types';
export { PaymentStatusValues, PAYMENT_STATUS } from './domain/types/payment-status.types';
export type { PaymentStatus } from './domain/types/payment-status.types';
export { OrderCreate, OrderRef, OrderSourceRef } from './domain/types/order-processor.types';
export {
  IncomingOrder,
  IncomingOrderItem,
  IncomingOrderItemRef,
  IncomingOrderTotals,
  IncomingOrderAddress,
} from './domain/types/incoming-order.types';
export {
  OrderFeedEventTypeValues,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
} from './domain/types/order-feed.types';
export {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
  OrderSyncStatusFilter,
  OrderSyncStatusFilterValues,
  OrderRecordStatus,
  OrderRecordStatusValues,
  OrderHealth,
  OrderHealthValues,
  OrderHealthSummary,
  OrderHealthSummaryFilters,
  OrderRecordSort,
  OrderRecordSortValues,
  OrderRecordSortDirection,
  OrderRecordSortDirectionValues,
} from './domain/types/order-record.types';
// Ship-by SLA axis + fulfillment rollup (#1108)
export {
  SlaState,
  SlaStateValues,
  SLA_AT_RISK_WINDOW_MS,
  OrderSlaSummary,
} from './domain/types/order-sla.types';
export {
  FulfillmentRollupState,
  FulfillmentRollupStateValues,
  FulfillmentRollupStateOrNull,
} from './domain/types/order-fulfillment.types';
export { deriveSlaState } from './domain/order-sla';

// Services
export { IOrderSyncService, OrderSyncRequest, OrderSyncResult } from './application/interfaces/order-sync.service.interface';
export {
  IOrderIngestionService,
  OrderIngestionOptions,
  OrderIngestionResult,
} from './application/interfaces/order-ingestion.service.interface';
export { IOrderRecordService } from './application/interfaces/order-record.service.interface';
export { OrderRecordService } from './application/services/order-record.service';
export {
  IOrderDestinationRetryService,
  OrderDestinationRetryInput,
  OrderDestinationRetryResult,
} from './application/interfaces/order-destination-retry.service.interface';
export * from './orders.tokens';

// Domain entities
export { OrderRecord } from './domain/entities/order-record.entity';
export {
  OrderSyncStatus,
  SyncAttempt,
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
} from './domain/types/order-sync.types';

// Domain exceptions
export { OrderRecordNotFoundException } from './domain/exceptions/order-record-not-found.exception';
export { MissingOrderItemMappingError } from './domain/exceptions/missing-order-item-mapping.error';
export { OrderDestinationNotFoundException } from './domain/exceptions/order-destination-not-found.exception';
export { OrderDestinationNotRetryableException } from './domain/exceptions/order-destination-not-retryable.exception';
export { MissingSourceExternalIdException } from './domain/exceptions/missing-source-external-id.exception';
export { OrderCreateContendedException } from './domain/exceptions/order-create-contended.exception';
export { OrderSnapshotUnavailableError } from './domain/exceptions/order-snapshot-unavailable.error';

// Typed-Order accessor for cross-context command composition (#1119).
export { orderFromReadySnapshot } from './domain/order-from-ready-snapshot';

// Ports
export { OrderRecordRepositoryPort } from './domain/ports/order-record-repository.port';

// ORM entities are exposed on the host-only `@openlinker/core/orders/orm-entities`
// sub-path (#594). Plugins must not import them from here.

// Module
export { OrdersModule } from './orders.module';




