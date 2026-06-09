/**
 * Shipping — Public Barrel
 *
 * Pure contracts plus the NestJS wiring module. Anything exported here is
 * part of the cross-context surface plugins and apps can value-import
 * from `@openlinker/core/shipping`.
 *
 * @module libs/core/src/shipping
 */

// Module
export { ShippingModule } from './shipping.module';

// Tokens
export * from './shipping.tokens';

// Domain types
export {
  ShipmentStatusValues,
  SHIPMENT_STATUS,
  TerminalShipmentStatusValues,
} from './domain/types/shipment-status.types';
export type {
  ShipmentStatus,
  TerminalShipmentStatus,
} from './domain/types/shipment-status.types';

export { ShippingMethodValues, SHIPPING_METHOD } from './domain/types/shipping-method.types';
export type { ShippingMethod } from './domain/types/shipping-method.types';
export { DeliveryIntentValues, DELIVERY_INTENT } from './domain/types/delivery-intent.types';
export type { DeliveryIntent } from './domain/types/delivery-intent.types';

export {
  PickupPointStatusValues,
  PICKUP_POINT_STATUS,
  PickupPointDayValues,
  PICKUP_POINT_DAY,
} from './domain/types/pickup-point.types';
export type {
  PickupPoint,
  PickupPointAddress,
  PickupPointStatus,
  PickupPointDay,
  PickupPointDayHours,
  PickupPointOpeningHours,
  FindPickupPointsQuery,
} from './domain/types/pickup-point.types';

export type {
  GenerateLabelCommand,
  GenerateLabelResult,
} from './domain/types/generate-label.types';

export type {
  ShipmentRecipient,
  ShipmentAddress,
} from './domain/types/shipment-recipient.types';
export type {
  ShipmentParcel,
  ShipmentDimensions,
} from './domain/types/shipment-parcel.types';
export type { ShipmentCod } from './domain/types/shipment-cod.types';

export type { TrackingSnapshot, KnownCarrier } from './domain/types/tracking-snapshot.types';
export { KnownCarrierValues } from './domain/types/tracking-snapshot.types';
export type { KnownProviderRejectionCode } from './domain/types/shipping-provider-rejection.types';
export { KnownProviderRejectionCodeValues } from './domain/types/shipping-provider-rejection.types';

export type {
  CreateShipmentInput,
  UpdateShipmentInput,
} from './domain/types/shipment.types';

export type {
  ShipmentFilters,
  ShipmentPagination,
  PaginatedShipments,
} from './domain/types/shipment-query.types';

// Domain entity
export { Shipment } from './domain/entities/shipment.entity';

// Ports
export type { ShippingProviderManagerPort } from './domain/ports/shipping-provider-manager.port';
export type { ShipmentRepositoryPort } from './domain/ports/shipment-repository.port';
export type { PickupPointCachePort } from './domain/ports/pickup-point-cache.port';
export type { PickupPointSearchCachePort } from './domain/ports/pickup-point-search-cache.port';
export type { PickupPointQueryStatsPort } from './domain/ports/pickup-point-query-stats.port';

// Sub-capabilities (#763 — sub-port + co-located type guard pattern per
// engineering-standards §"Port sub-capabilities").
export type { ShipmentCanceller } from './domain/ports/capabilities/shipment-canceller.capability';
export { isShipmentCanceller } from './domain/ports/capabilities/shipment-canceller.capability';
export type { PickupPointFinder } from './domain/ports/capabilities/pickup-point-finder.capability';
export { isPickupPointFinder } from './domain/ports/capabilities/pickup-point-finder.capability';
export type { LabelDocumentReader } from './domain/ports/capabilities/label-document-reader.capability';
export { isLabelDocumentReader } from './domain/ports/capabilities/label-document-reader.capability';
export type { DispatchProtocolReader } from './domain/ports/capabilities/dispatch-protocol-reader.capability';
export { isDispatchProtocolReader } from './domain/ports/capabilities/dispatch-protocol-reader.capability';
export type { LabelDocument } from './domain/types/label-document.types';

// `FulfillmentStatusReader` (#834) lives in `@openlinker/core/orders`
// alongside `OrderFulfillmentUpdater` (#858) — both are sub-capabilities of
// `OrderProcessorManagerPort` and follow the same placement convention.
// The shipping context's `FulfillmentStatusSyncService` consumes it and
// projects the OMP's view onto the shipping-owned `ShipmentStatus`.

// Domain exceptions
export { ShipmentNotFoundException } from './domain/exceptions/shipment-not-found.exception';
export { UndispatchableResolutionException } from './domain/exceptions/undispatchable-resolution.exception';
export { OrderNotDispatchablePaymentStatusException } from './domain/exceptions/order-not-dispatchable-payment-status.exception';
export { ShipmentNotCancellableException } from './domain/exceptions/shipment-not-cancellable.exception';
export { ShipmentCancellationNotSupportedException } from './domain/exceptions/shipment-cancellation-not-supported.exception';
export { PickupPointFinderNotSupportedException } from './domain/exceptions/pickup-point-finder-not-supported.exception';
export { ShippingProviderRejectionException } from './domain/exceptions/shipping-provider-rejection.exception';
export { LabelDocumentNotSupportedException } from './domain/exceptions/label-document-not-supported.exception';
export { LabelNotAvailableException } from './domain/exceptions/label-not-available.exception';
export { DispatchProtocolNotSupportedException } from './domain/exceptions/dispatch-protocol-not-supported.exception';
export { InvalidProtocolBatchException } from './domain/exceptions/invalid-protocol-batch.exception';

// Application — dispatch seam (#835). Interface + types only; the service
// class is injected via SHIPMENT_DISPATCH_SERVICE_TOKEN (exported above via
// `export * from './shipping.tokens'`), never value-imported.
export type { IShipmentDispatchService } from './application/interfaces/shipment-dispatch.service.interface';
export type {
  ShipmentDispatchInput,
  ShipmentDispatchResult,
} from './application/types/shipment-dispatch.types';

// Application — bulk-dispatch + handover-protocol seam (#964, ADR-019).
// Interface + types only; the service is injected via
// BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN.
export type { IBulkShipmentDispatchService } from './application/interfaces/bulk-shipment-dispatch.service.interface';
export type {
  BulkShipmentDispatchInput,
  BulkShipmentDispatchItem,
  BulkShipmentDispatchResult,
  PerOrderDispatchResult,
} from './application/types/bulk-shipment-dispatch.types';

// Application — read + cancel seams (#846). Interfaces only; services are
// injected via SHIPMENT_QUERY_SERVICE_TOKEN / SHIPMENT_CANCELLATION_SERVICE_TOKEN.
export type { IShipmentQueryService } from './application/interfaces/shipment-query.service.interface';
export type { IShipmentCancellationService } from './application/interfaces/shipment-cancellation.service.interface';

// Application — label-document fetch seam (#884). Interface only; the service
// is injected via SHIPMENT_LABEL_SERVICE_TOKEN.
export type { IShipmentLabelService } from './application/interfaces/shipment-label.service.interface';

// Application — pickup-point lookup seam (#766). Interface only; the service is
// injected via PICKUP_POINT_LOOKUP_SERVICE_TOKEN.
export type { IPickupPointLookupService } from './application/interfaces/pickup-point-lookup.service.interface';

// Application — pickup-point background-refresh seam (#849). Interface + result
// type only; the service is injected via PICKUP_POINT_REFRESH_SERVICE_TOKEN.
export type { IPickupPointRefreshService } from './application/interfaces/pickup-point-refresh.service.interface';
export type { PickupPointRefreshResult } from './application/types/pickup-point-refresh.types';

// Application — dispatch-notify seam (#837). Interface + result types only; the
// service is injected via SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN.
export type { IShipmentDispatchNotificationService } from './application/interfaces/shipment-dispatch-notification.service.interface';
export type {
  ShipmentDispatchNotificationInput,
  ShipmentDispatchNotificationResult,
} from './application/types/shipment-dispatch-notification.types';

// Application — shipment-status-sync seam (#838). Interface + result types only; the
// service is injected via SHIPMENT_STATUS_SYNC_SERVICE_TOKEN. The cursor-based
// worker handler drives it the same way OfferStatusSync (#816) drives its service.
export type { IShipmentStatusSyncService } from './application/interfaces/shipment-status-sync.service.interface';
export type {
  ShipmentStatusSyncOptions,
  ShipmentStatusSyncResult,
} from './application/types/shipment-status-sync.types';

// Application — branch-1 fulfillment-status-sync seam (#834). Interface +
// result types only; the service is injected via
// FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN. Sister-service to
// ShipmentStatusSyncService; disjoint by branch (branch-1 vs branches 2/3).
export type { IFulfillmentStatusSyncService } from './application/interfaces/fulfillment-status-sync.service.interface';
export type {
  FulfillmentStatusSyncOptions,
  FulfillmentStatusSyncResult,
} from './application/types/fulfillment-status-sync.types';
export { DEFAULT_UPDATED_SINCE_DAYS } from './application/types/fulfillment-status-sync.types';
