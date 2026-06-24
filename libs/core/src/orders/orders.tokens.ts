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



