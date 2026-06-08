/**
 * Dependency Injection Tokens (Shipping)
 *
 * Symbol tokens for the shipping context's DI bindings. Per
 * engineering-standards §"Symbol DI Token Re-export Convention" this file
 * contains ONLY Symbol declarations; types / helpers / constants belong
 * in their own files (the sub-barrel uses `export *` here, so non-Symbol
 * exports would widen the public surface unintentionally).
 *
 * @module libs/core/src/shipping
 */

export const SHIPMENT_REPOSITORY_TOKEN = Symbol('ShipmentRepositoryPort');
export const PICKUP_POINT_CACHE_TOKEN = Symbol('PickupPointCachePort');
export const SHIPMENT_DISPATCH_SERVICE_TOKEN = Symbol('IShipmentDispatchService');
export const SHIPMENT_QUERY_SERVICE_TOKEN = Symbol('IShipmentQueryService');
export const SHIPMENT_CANCELLATION_SERVICE_TOKEN = Symbol('IShipmentCancellationService');
export const PICKUP_POINT_LOOKUP_SERVICE_TOKEN = Symbol('IPickupPointLookupService');
export const SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN = Symbol(
  'IShipmentDispatchNotificationService',
);
export const SHIPMENT_STATUS_SYNC_SERVICE_TOKEN = Symbol('IShipmentStatusSyncService');
export const FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN = Symbol('IFulfillmentStatusSyncService');
export const SHIPMENT_LABEL_SERVICE_TOKEN = Symbol('IShipmentLabelService');
