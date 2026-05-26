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

export type { TrackingSnapshot } from './domain/types/tracking-snapshot.types';

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

// Sub-capabilities (#763 — sub-port + co-located type guard pattern per
// engineering-standards §"Port sub-capabilities").
export type { ShipmentCanceller } from './domain/ports/capabilities/shipment-canceller.capability';
export { isShipmentCanceller } from './domain/ports/capabilities/shipment-canceller.capability';
export type { PickupPointFinder } from './domain/ports/capabilities/pickup-point-finder.capability';
export { isPickupPointFinder } from './domain/ports/capabilities/pickup-point-finder.capability';

// Domain exceptions
export { ShipmentNotFoundException } from './domain/exceptions/shipment-not-found.exception';
export { UndispatchableResolutionException } from './domain/exceptions/undispatchable-resolution.exception';
export { ShipmentNotCancellableException } from './domain/exceptions/shipment-not-cancellable.exception';
export { ShipmentCancellationNotSupportedException } from './domain/exceptions/shipment-cancellation-not-supported.exception';

// Application — dispatch seam (#835). Interface + types only; the service
// class is injected via SHIPMENT_DISPATCH_SERVICE_TOKEN (exported above via
// `export * from './shipping.tokens'`), never value-imported.
export type { IShipmentDispatchService } from './application/interfaces/shipment-dispatch.service.interface';
export type {
  ShipmentDispatchInput,
  ShipmentDispatchResult,
} from './application/types/shipment-dispatch.types';

// Application — read + cancel seams (#846). Interfaces only; services are
// injected via SHIPMENT_QUERY_SERVICE_TOKEN / SHIPMENT_CANCELLATION_SERVICE_TOKEN.
export type { IShipmentQueryService } from './application/interfaces/shipment-query.service.interface';
export type { IShipmentCancellationService } from './application/interfaces/shipment-cancellation.service.interface';
