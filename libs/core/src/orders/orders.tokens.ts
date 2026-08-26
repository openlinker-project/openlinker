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
// Re-enqueues the source-side provisioning run a released hold had suppressed (#2341).
export const ORDER_PROVISIONING_RESUME_SERVICE_TOKEN = Symbol(
  'IOrderProvisioningResumeService'
);
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



// ADR-044 change proposals (#2333). `OrderChangesModule` is a LEAF module inside
// this context — a sibling context imports that, never `OrdersModule`, and
// reaches the record through `IOrderChangeService`, never the repository port.
export const ORDER_CHANGE_REPOSITORY_TOKEN = Symbol('OrderChangeRepositoryPort');
export const ORDER_CHANGE_SERVICE_TOKEN = Symbol('IOrderChangeService');

// Order holds (#2338, DESIGN §6.3 / REVIEW §3 H9). `OrderHoldsModule` is a LEAF
// module inside this context — #2339's service imports THAT, never
// `OrdersModule`, and a sibling context reaches holds through
// `IOrderHoldService` rather than the repository port.
export const ORDER_HOLD_REPOSITORY_TOKEN = Symbol('OrderHoldRepositoryPort');

// The cross-context seam for holds (#2339). Exported by `OrderHoldsModule` and
// re-exported through `OrdersModule`, so shipping's dispatch gate can inject it
// without deep-importing anything.
export const ORDER_HOLD_SERVICE_TOKEN = Symbol('IOrderHoldService');

/** #2340 — the `order_records.activeHoldReason` cache's only write statement. */
export const ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN = Symbol(
  'OrderHoldProjectionRepositoryPort'
);

/** #2340 — the bounded `orders.holds.reconcile` repair pass. */
export const ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN = Symbol(
  'IOrderHoldProjectionReconcileService'
);
