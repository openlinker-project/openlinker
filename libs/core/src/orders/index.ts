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
// Destination post-create fulfillment update (#858). Retained for order
// provisioning (OL driving an order it created), outside the relay path;
// the source-side dispatch notify folded into OrderStatusWriteback (#1168).
export type { OrderFulfillmentUpdater } from './domain/ports/capabilities/order-fulfillment-updater.capability';
export { isOrderFulfillmentUpdater } from './domain/ports/capabilities/order-fulfillment-updater.capability';
// Read-back counterpart to OrderFulfillmentUpdater (#834): branch-1
// shipment-status projection from the OMP's view.
export type { FulfillmentStatusReader } from './domain/ports/capabilities/fulfillment-status-reader.capability';
export { isFulfillmentStatusReader } from './domain/ports/capabilities/fulfillment-status-reader.capability';
// Order status writeback (#1157 / ADR-027): the single platform-neutral,
// role-agnostic writeback contract the lifecycle relay dispatches through.
// Collapses the writeback role of OrderDispatchNotifier + OrderFulfillmentUpdater
// (event-as-data); per-participant support reported via OrderWritebackResult.
export type { OrderStatusWriteback } from './domain/ports/capabilities/order-status-writeback.capability';
export { isOrderStatusWriteback } from './domain/ports/capabilities/order-status-writeback.capability';
export type {
  OrderLifecycleEvent,
  OrderLifecycleEventType,
  OrderWritebackOutcome,
  OrderWritebackResult,
} from './domain/types/order-lifecycle-event.types';
export {
  OrderLifecycleEventTypeValues,
  OrderWritebackOutcomeValues,
} from './domain/types/order-lifecycle-event.types';

// Return source reader (#2329 / ADR-060): the returns half of OrderSource.
// Advertised-without-dispatch — narrow the dispatched OrderSource adapter with
// the guard; never getCapabilityAdapter('ReturnSourceReader').
export type { ReturnSourceReader } from './domain/ports/capabilities/return-source-reader.capability';
export { isReturnSourceReader } from './domain/ports/capabilities/return-source-reader.capability';
// The one return WRITE (#2333, ADR-060/ADR-044) — a capability of its own, NOT a
// method on the read-only `ReturnSourceReader`. See the capability's docblock.
export type { ReturnDecliner } from './domain/ports/capabilities/return-decliner.capability';
export { isReturnDecliner } from './domain/ports/capabilities/return-decliner.capability';
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
  OrderPickupPointType,
  OrderDispatchWindow,
} from './domain/types/order.types';
export { OrderPickupPointTypeValues } from './domain/types/order.types';
export { PaymentStatusValues, PAYMENT_STATUS } from './domain/types/payment-status.types';
export type { PaymentStatus } from './domain/types/payment-status.types';
export type { CodToCollect } from './domain/types/cod-to-collect.types';
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
  FailedSyncValueSummary,
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
// Per-order reporting-currency snapshot (#2124, ADR-040).
export type { OrderFxIntent, OrderFxStamp } from './domain/types/order-fx.types';
export type { StampedReportingCurrencyCount } from './domain/types/order-fx-read.types';
// The stamp's own outcome vocabulary (#2125) — read by the worker handlers.
export { FX_STAMP_TERMINAL_REASONS } from './domain/types/order-fx-stamp.types';
export type {
  FxStampDeferredOutcome,
  FxStampOutcome,
  FxStampStampedOutcome,
  FxStampTerminalOutcome,
  FxStampTerminalReason,
  OrderFxSweepOptions,
  OrderFxSweepResult,
} from './domain/types/order-fx-stamp.types';
// Sales & channel analytics (#1987) — response shapes for
// IOrderRecordService.getSalesAndChannelAnalytics.
export {
  SalesAnalyticsFilters,
  SalesAnalyticsHeadline,
  ChannelSalesAnalytics,
  SalesAndChannelAnalytics,
  DailyTrendPoint,
} from './domain/types/order-sales-analytics.types';

// Top products analytics (#1988) — response shapes for
// IOrderRecordService.getTopProducts.
export { TopProductSortByValues } from './domain/types/top-products.types';
export type {
  TopProductSortBy,
  TopProductFilters,
  TopProductView,
  TopProductsResult,
  ProductChannelBreakdownRow,
} from './domain/types/top-products.types';

// Refund record capture (#2036).
export {
  RefundReason,
  RefundReasonValues,
  RefundSummary,
  CreateRefundRecordInput,
} from './domain/types/refund-record.types';

// Services
export { IOrderSyncService, OrderSyncRequest, OrderSyncResult } from './application/interfaces/order-sync.service.interface';
export {
  IOrderIngestionService,
  OrderIngestionOptions,
  OrderIngestionResult,
} from './application/interfaces/order-ingestion.service.interface';
export { IOrderRecordService } from './application/interfaces/order-record.service.interface';
export { OrderRecordService } from './application/services/order-record.service';
export type { IOrderFxStampService } from './application/interfaces/order-fx-stamp.service.interface';
// FX aggregate reads for the reporting-currency settings surface (#2126).
export type { IOrderFxReadService } from './application/interfaces/order-fx-read.service.interface';
export {
  IOrderDestinationRetryService,
  OrderDestinationRetryInput,
  OrderDestinationRetryResult,
} from './application/interfaces/order-destination-retry.service.interface';
export type {
  IOrderLifecycleRelayService,
  OrderLifecycleRelayInput,
  OrderLifecycleRelayResult,
  OrderLifecycleRelayTargetResult,
} from './application/interfaces/order-lifecycle-relay.service.interface';
export type { IOrderRefundService } from './application/interfaces/order-refund.service.interface';
export { OrderRefundService } from './application/services/order-refund.service';
export type {
  ITaxRateBackfillService,
  TaxRateBackfillPageInput,
  TaxRateBackfillPageResult,
} from './application/services/tax-rate-backfill.service.interface';
export * from './orders.tokens';

// Domain entities
export { OrderRecord } from './domain/entities/order-record.entity';
export { RefundRecord } from './domain/entities/refund-record.entity';
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
export { DuplicateRefundRecordException } from './domain/exceptions/duplicate-refund-record.exception';
export { RefundCurrencyMismatchException } from './domain/exceptions/refund-currency-mismatch.exception';

// Typed-Order accessor for cross-context command composition (#1119).
export { orderFromReadySnapshot } from './domain/order-from-ready-snapshot';
export type { OrderFromReadySnapshotOptions } from './domain/order-from-ready-snapshot';

// Order-identity list projection for Shipments/Invoices (#1995).
export { diffOrderAmendment, OrderAmendmentChangeKindValues } from './domain/order-amendment-diff';
export type {
  OrderAmendmentChange,
  OrderAmendmentChangeKind,
  OrderAmendmentDiffOptions,
} from './domain/order-amendment-diff';
export { redactAddress, REDACTED_PLACEHOLDER } from './domain/order-address-redaction';
export type { RedactableAddress, RedactedAddress } from './domain/order-address-redaction';

export { buildOrderSummary } from './domain/order-summary-projection';
export type { OrderSummary } from './domain/order-summary-projection';

// Ports
export { OrderRecordRepositoryPort } from './domain/ports/order-record-repository.port';

// ADR-044 change proposals (#2333) — the Wave-2 gate. `OrderChangeRepositoryPort`
// is deliberately NOT exported: it is intra-context, and a sibling reaches the
// record through `IOrderChangeService` alone.
export {
  OrderChangeKindValues,
  OrderChangeStatusValues,
  OPEN_ORDER_CHANGE_STATUSES,
  isOrderChangeKind,
  isOrderChangeStatus,
  isOpenOrderChangeStatus,
} from './domain/types/order-change.types';
export type {
  OrderChangeKind,
  OrderChangeStatus,
  CreateOrderChangeInput,
} from './domain/types/order-change.types';
export { OrderChange } from './domain/entities/order-change.entity';
export type {
  IOrderChangeService,
  OpenOrderChangeResult,
} from './application/services/order-change.service.interface';

// ORM entities are exposed on the host-only `@openlinker/core/orders/orm-entities`
// sub-path (#594). Plugins must not import them from here.

// Module
export { OrdersModule } from './orders.module';
// Leaf module carrying `order_changes` only — see its docblock for why a
// sibling context must import THIS rather than `OrdersModule` (#2333).
export { OrderChangesModule } from './order-changes.module';




