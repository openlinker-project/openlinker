/**
 * Shipment Dispatch Notification Service Interface
 *
 * Contract for the branch-agnostic "mark sent" orchestration (#837, spec
 * step 5): given a dispatched `Shipment`, notify the order source (mark sent +
 * attach waybill via `OrderDispatchNotifier`) and update the destination
 * OMP(s) (status + tracking via `OrderFulfillmentUpdater`). Trigger-agnostic:
 * the live caller (manual / auto-on-shipped) is #769/#771, mirroring how
 * `IShipmentDispatchService` shipped without a trigger in #835.
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
