/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the orders module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/orders
 */

// Token for dependency injection (interfaces can't be used as values)
export const ORDER_SYNC_SERVICE_TOKEN = Symbol('IOrderSyncService');
export const ORDER_INGESTION_SERVICE_TOKEN = Symbol('IOrderIngestionService');
export const ORDER_RECORD_REPOSITORY_TOKEN = Symbol('OrderRecordRepositoryPort');
export const ORDER_RECORD_SERVICE_TOKEN = Symbol('IOrderRecordService');
export const ORDER_DESTINATION_RETRY_SERVICE_TOKEN = Symbol('IOrderDestinationRetryService');
export const ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN = Symbol('IOrderItemRefResolverService');
export const ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN = Symbol('IOrderLifecycleRelayService');
// Per-order reporting-currency stamp (#2125, ADR-040).
export const ORDER_FX_STAMP_SERVICE_TOKEN = Symbol('IOrderFxStampService');
// FX aggregate reads consumed by the reporting-currency settings surface (#2126).
export const ORDER_FX_READ_SERVICE_TOKEN = Symbol('IOrderFxReadService');
// Refund record capture (#2036).
export const ORDER_REFUND_RECORD_REPOSITORY_TOKEN = Symbol('RefundRecordRepositoryPort');
export const ORDER_REFUND_SERVICE_TOKEN = Symbol('IOrderRefundService');
export const ORDER_LINE_ITEM_REPOSITORY_TOKEN = Symbol('OrderLineItemRepositoryPort');
// Tax-rate backfill sweep for pre-#2245 lines (#2440).
export const TAX_RATE_BACKFILL_SERVICE_TOKEN = Symbol('ITaxRateBackfillService');
// One per-order sales-document read (#2516, ADR-065).
export const SALES_DOCUMENT_VIEW_SERVICE_TOKEN = Symbol('ISalesDocumentViewService');
// Analytics display-currency conversion read model (#2458, ADR-064).
export const DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN = Symbol(
  'IDisplayCurrencyConversionService'
);
