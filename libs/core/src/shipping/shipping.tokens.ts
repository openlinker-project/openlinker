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
