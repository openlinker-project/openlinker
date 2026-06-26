/**
 * Shipment Dispatch Notification Service Interface
 *
 * Contract for the branch-agnostic "mark sent" orchestration (#837, spec
 * step 5): given a dispatched `Shipment`, propagate "shipped + tracking" to the
 * order's source marketplace and destination shop(s) through the single
 * role-agnostic `OrderStatusWriteback` lifecycle relay (#1168 / ADR-027).
 * Trigger-agnostic: the live caller (manual / auto-on-shipped) is #769/#771,
 * mirroring how `IShipmentDispatchService` shipped without a trigger in #835.
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type {
  ShipmentDispatchNotificationInput,
  ShipmentDispatchNotificationResult,
} from '../types/shipment-dispatch-notification.types';

export interface IShipmentDispatchNotificationService {
  notifyDispatched(
    input: ShipmentDispatchNotificationInput,
  ): Promise<ShipmentDispatchNotificationResult>;
}
