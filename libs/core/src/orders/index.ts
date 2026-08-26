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

// The refund WRITE (#2371, ADR-056) — implemented by NOBODY today, deliberately.
// UNDECLARED rather than advertised-without-dispatch: there is no adapter to
// advertise. See the capability's docblock.
export type { RefundExecutor } from './domain/ports/capabilities/refund-executor.capability';
export { isRefundExecutor } from './domain/ports/capabilities/refund-executor.capability';
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
export type { BuyerTaxId } from './domain/types/buyer-tax-id.types';
export {
  readBuyerTaxId,
  buyerHasTaxId,
  encodeBuyerTaxIdColumn,
  decodeBuyerTaxIdColumn,
  readSourceBuyerTaxId,
} from './domain/types/buyer-tax-id.types';
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

// Data Coverage detection (epic #2452, mini-epic #2463) — shared vocabulary
// consumed by the currency-mismatch detector (#2464) and its sibling
// detectors (#2465/#2466).
export {
  CoverageCategoryValues,
  CoverageResolutionStatusValues,
  TaxCoverageCategoryValues,
} from './domain/types/coverage-detection.types';
export type {
  CoverageCategory,
  CoverageResolutionStatus,
  CoverageDetectionPagination,
  CurrencyMismatchOrderRow,
  PaginatedCurrencyMismatchOrders,
  TaxCoverageCategory,
  TaxCoverageOrderRow,
  PaginatedTaxCoverageOrders,
  NetExcludedOrderCandidate,
  TaxCoverageClassification,
} from './domain/types/coverage-detection.types';

// Top products analytics (#1988) — response shapes for
// IOrderRecordService.getTopProducts. VariantRankingRow/VariantChannelBreakdownRow/
// VariantSalesView/VariantSalesResult (#2765) are the per-product variant-sales
// drill-down's shapes, for IOrderRecordService.getTopProductVariantSales.
export { TopProductSortByValues } from './domain/types/top-products.types';
export type {
  TopProductSortBy,
  TopProductFilters,
  TopProductView,
  TopProductsResult,
  ProductChannelBreakdownRow,
  VariantRankingRow,
  VariantChannelBreakdownRow,
  VariantSalesView,
  VariantSalesResult,
} from './domain/types/top-products.types';

// Refund record capture (#2036); `RefundExecutedBy` + the `returnId` link (#2371).
export {
  RefundReason,
  RefundReasonValues,
  RefundSummary,
  CreateRefundRecordInput,
  RefundExecutedBy,
} from './domain/types/refund-record.types';
export { RefundExecutedByValues } from './domain/types/refund-record.types';

// Refund EXECUTION (#2371, ADR-056) — the command/result a `RefundExecutor`
// speaks. Declared here rather than in `returns` because the vocabulary is
// orders' own and a refund is not inherently about a return.
export type {
  ExecuteRefundCommand,
  RefundExecutionResult,
  RefundExecutionOutcome,
} from './domain/types/refund-execution.types';
export { RefundExecutionOutcomeValues } from './domain/types/refund-execution.types';

// Analytics display-currency conversion read model (#2458, ADR-064, pending in PR #2485).
export {
  DISPLAY_CURRENCY_RATE_BASIS_VALUES,
  MIXED_NATIVE_CURRENCIES_LABEL,
  isDisplayCurrencyRateBasis,
} from './domain/types/display-currency.types';
export type {
  DisplayCurrencyRateBasis,
  NativeCurrencyAmount,
  CurrentRateConversionInput,
  NativeCurrencyBreakdown,
  CurrentRateConversionResult,
  OrderDateConversionInput,
  OrderDateConversionResult,
} from './domain/types/display-currency.types';

// Services
export {
  IOrderSyncService,
  OrderSyncRequest,
  OrderSyncResult,
} from './application/interfaces/order-sync.service.interface';
export {
  IOrderIngestionService,
  OrderIngestionOptions,
  OrderIngestionResult,
} from './application/interfaces/order-ingestion.service.interface';

// #2396 — the SINGLE fulfilment-router resolution seam, shared by the ingestion
// intercept and the `fulfillment.work.route` handler. Exported so the worker
// handler consumes the same body; a second copy is a double shipment the day
// #2408 wires a real router into only one of them.
export { resolveFulfillmentRouter } from './application/services/fulfillment-router-resolution';
export { IOrderRecordService } from './application/interfaces/order-record.service.interface';
export { OrderRecordService } from './application/services/order-record.service';
export { ISalesDocumentViewService } from './application/interfaces/sales-document-view.service.interface';
export { SalesDocumentViewService } from './application/services/sales-document-view.service';
export type { IOrderFxStampService } from './application/interfaces/order-fx-stamp.service.interface';
// FX aggregate reads for the reporting-currency settings surface (#2126).
export type { IOrderFxReadService } from './application/interfaces/order-fx-read.service.interface';
export {
  IOrderDestinationRetryService,
  OrderDestinationRetryInput,
  OrderDestinationRetryResult,
} from './application/interfaces/order-destination-retry.service.interface';
// Release -> provisioning resume (#2341). Closes the gap #2339 stated: releasing
// a hold un-blocks the next run but nothing enqueued it, and a cursor-based
// source journal never re-delivers the original event.
export type {
  IOrderProvisioningResumeService,
  OrderProvisioningResumeResult,
  ProvisioningResumeSkipReason,
} from './application/interfaces/order-provisioning-resume.service.interface';
export { ProvisioningResumeSkipReasonValues } from './application/interfaces/order-provisioning-resume.service.interface';
export type {
  IOrderLifecycleRelayService,
  OrderLifecycleRelayInput,
  OrderLifecycleRelayResult,
  OrderLifecycleRelayTargetResult,
} from './application/interfaces/order-lifecycle-relay.service.interface';
// #2401: the `dispatch` fulfilment-progress intent consumer.
export type {
  FulfillmentDispatchIntent,
  FulfillmentDispatchRelayOutcome,
  IFulfillmentDispatchRelayService,
} from './application/interfaces/fulfillment-dispatch-relay.service.interface';
export { FULFILLMENT_DISPATCH_RELAY_ORIGIN } from './application/services/fulfillment-dispatch-relay.service';
export type { IOrderRefundService } from './application/interfaces/order-refund.service.interface';
export { OrderRefundService } from './application/services/order-refund.service';
export type {
  ITaxRateBackfillService,
  TaxRateBackfillPageInput,
  TaxRateBackfillPageResult,
} from './application/services/tax-rate-backfill.service.interface';
export type { ITaxCoverageDetectionService } from './application/services/tax-coverage-detection.service.interface';
export type { IDisplayCurrencyConversionService } from './application/interfaces/display-currency-conversion.service.interface';
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
export { OrderChangeVocabularyError } from './domain/exceptions/order-change-vocabulary.error';

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

// Order holds (#2338) — the first OL-owned lifecycle write.
// `OrderHoldRepositoryPort` is deliberately NOT exported: it is intra-context,
// and a sibling reaches the record through `IOrderHoldService` (#2339) alone —
// the `OrderChangeRepositoryPort` precedent directly above.
export { OrderHold } from './domain/entities/order-hold.entity';
export type {
  OrderHoldPlacedBy,
  PlaceOrderHoldInput,
  ReleaseOrderHoldInput,
} from './domain/types/order-hold.types';
export { OrderAlreadyOnHoldError } from './domain/exceptions/order-already-on-hold.error';
export { OrderHoldContendedError } from './domain/exceptions/order-hold-contended.error';
export { HoldAlreadyReleasedError } from './domain/exceptions/hold-already-released.error';
export { OrderHoldNotFoundError } from './domain/exceptions/order-hold-not-found.error';
export { OrderHoldVocabularyError } from './domain/exceptions/order-hold-vocabulary.error';
export { HoldReleaseNoteRequiredError } from './domain/exceptions/hold-release-note-required.error';
export { HoldReleaseNotPermittedError } from './domain/exceptions/hold-release-not-permitted.error';
// The hold seam a sibling context uses (#2339) — service interface + its request
// shapes. The repository port stays unexported, one line above.
export type {
  IOrderHoldService,
  OrderHoldTransition,
  PlaceHoldRequest,
  ReleaseHoldRequest,
} from './application/interfaces/order-hold.service.interface';
export type {
  IOrderChangeService,
  OpenOrderChangeResult,
} from './application/services/order-change.service.interface';

// The automation facts projection (#2363). Exported because it has two callers
// that must agree — the T5 packed emission here and the §5.6(a) dry run in
// `apps/api` — and a preview built from a different projection than the firing
// is a preview of something else.
export {
  buildOrderAutomationFacts,
  readSnapshotCountry,
} from './domain/order-automation-facts-projection';

// ORM entities are exposed on the host-only `@openlinker/core/orders/orm-entities`
// sub-path (#594). Plugins must not import them from here.

// Module
export { OrdersModule } from './orders.module';
// Leaf module carrying `order_changes` only — see its docblock for why a
// sibling context must import THIS rather than `OrdersModule` (#2333).
export { OrderChangesModule } from './order-changes.module';
// Leaf module carrying `order_holds` only (#2338). `OrdersModule` imports it,
// but #2339's `OrderHoldService` takes THIS rather than `OrdersModule` — see
// its docblock for why the narrow seam matters.
// #2340 — the `order_records.activeHoldReason` reconcile seam. The worker
// handler reaches the pass through this interface; the projection REPOSITORY
// port stays intra-context (a cache's write statement is nobody else's
// business, and no hold gate may read the column at all).
export type { IOrderHoldProjectionReconcileService } from './application/interfaces/order-hold-projection-reconcile.service.interface';
export type { HoldProjectionReconcileResult } from './domain/types/order-hold-projection.types';
export { OrderHoldsModule } from './order-holds.module';
