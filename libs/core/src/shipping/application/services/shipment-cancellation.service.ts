/**
 * Shipment Cancellation Service
 *
 * Voids a not-yet-dispatched shipment (#846, absorbing the cancel residual
 * from #845). Resolves the shipment's shipping-provider adapter via the
 * integrations registry, narrows the `ShipmentCanceller` sub-capability, calls
 * `cancelShipment` on the provider (when a provider shipment exists), and
 * advances the `Shipment` to `cancelled`.
 *
 * Cancellable window: `draft`, `generated` and - since #3365 - `dispatched`.
 * Terminal states (`delivered`, `failed`, and a second `cancelled`) are
 * rejected.
 *
 * ## Why `dispatched` was added
 *
 * It used to be excluded on the grounds that the carrier has the parcel and a
 * provider-side void is no longer clean. Both halves of that are still true;
 * what changed is that the window closed in SECONDS.
 * `ShipmentDispatchService` enqueues the dispatch notification the moment a
 * label is bought (#3365's automatic notify), and that notification advances
 * the row to `dispatched` - so an operator who bought the wrong label could not
 * void it at all. They paid for a parcel they would not send, AND the
 * marketplace believed it shipped. Refusing bought neither of those back.
 *
 * The `ShipmentCanceller` contract permits this: it says behaviour on a
 * dispatched shipment is provider-specific, often a no-op or a 4xx, and that
 * callers should check `Shipment.status` first. This does check it, proceeds
 * deliberately, and a provider that refuses is surfaced by the existing
 * rethrow below rather than papered over.
 *
 * ## What it does NOT do
 *
 * It sends NOTHING to the marketplace. `OrderLifecycleEvent` carries
 * `dispatched` and `cancelled`, and `cancelled` means the BUYER'S ORDER is
 * cancelled - a different and usually false claim when an operator voided a
 * label, which the contract itself says a participant may reject after
 * shipping. So there is no honest compensating event, and inventing one would
 * put a false statement about somebody's order on a marketplace. The
 * cancellation reports `cancelledAfterDispatch` instead and leaves the operator
 * to settle the notification by hand.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentCancellationService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IShipmentCancellationService } from '../interfaces/shipment-cancellation.service.interface';
import { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import type { ShipmentCancellationResult } from '../../domain/types/shipment-cancellation.types';
import { ShipmentCancellationNotSupportedException } from '../../domain/exceptions/shipment-cancellation-not-supported.exception';
import { ShipmentNotCancellableException } from '../../domain/exceptions/shipment-not-cancellable.exception';
import { ShipmentNotFoundException } from '../../domain/exceptions/shipment-not-found.exception';
import { isShipmentCanceller } from '../../domain/ports/capabilities/shipment-canceller.capability';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_STATUS, type ShipmentStatus } from '../../domain/types/shipment-status.types';
import {
  ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN,
  SHIPMENT_REPOSITORY_TOKEN,
} from '../../shipping.tokens';

/** Capability the shipment's connection must declare to resolve a provider adapter. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

/**
 * Statuses from which a shipment can still be voided.
 *
 * `Dispatched` is in here deliberately - see the module docblock. Terminal
 * states are not: a `delivered` parcel is with the buyer and a `failed` one
 * never became anything to void.
 */
const CANCELLABLE_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Draft,
  SHIPMENT_STATUS.Generated,
  SHIPMENT_STATUS.Dispatched,
];

@Injectable()
export class ShipmentCancellationService implements IShipmentCancellationService {
  private readonly logger = new Logger(ShipmentCancellationService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN)
    private readonly fulfillmentProjection: IOrderFulfillmentProjectionService,
  ) {}

  async cancel(shipmentId: string): Promise<ShipmentCancellationResult> {
    const shipment = await this.shipments.findById(shipmentId);
    if (!shipment) {
      throw new ShipmentNotFoundException(shipmentId);
    }

    // Idempotent: re-cancelling an already-cancelled shipment is a no-op.
    //
    // It reports `cancelledAfterDispatch: false`, which is the honest answer
    // for a REPLAY rather than a claim about the original: this call cancelled
    // nothing, so it has nothing outstanding to report. The original call's
    // answer is the one that carried the fact, and `dispatchedAt` on the row
    // is what survives for anyone asking later.
    if (shipment.status === SHIPMENT_STATUS.Cancelled) {
      return { shipment, cancelledAfterDispatch: false };
    }

    // Captured BEFORE anything is written, because the update below moves the
    // status and the answer is about the state the operator cancelled from.
    const cancelledAfterDispatch = shipment.status === SHIPMENT_STATUS.Dispatched;

    if (!CANCELLABLE_STATUSES.includes(shipment.status)) {
      throw new ShipmentNotCancellableException(
        shipmentId,
        `status is '${shipment.status}' (only ${CANCELLABLE_STATUSES.join(' / ')} can be cancelled)`,
      );
    }

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      shipment.connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isShipmentCanceller(adapter)) {
      throw new ShipmentCancellationNotSupportedException(shipmentId, shipment.connectionId);
    }

    // A `draft` may have no provider shipment yet (label never generated) — only
    // void provider-side when there's something to void.
    if (shipment.providerShipmentId) {
      try {
        await adapter.cancelShipment({ providerShipmentId: shipment.providerShipmentId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `cancelShipment failed for shipment ${shipmentId} (provider ${shipment.providerShipmentId}): ${message}`,
        );
        // Intentionally leave the row untouched (still `generated`) — a failed
        // void should stay cancellable/retryable, NOT flip to a terminal state.
        // (Contrast the dispatch seam, which persists `failed` on label-gen error.)
        throw error;
      }
    }

    const cancelled = await this.shipments.update(shipmentId, {
      status: SHIPMENT_STATUS.Cancelled,
      cancelledAt: new Date(),
    });
    // Reflect the cancellation in the order's fulfillment rollup (#1108).
    await this.fulfillmentProjection.recompute(shipment.orderId);

    if (cancelledAfterDispatch) {
      // Logged as well as returned: the return value reaches whoever made the
      // call, and this condition is one an operator may have to act on later,
      // from a different surface than the one they cancelled from.
      this.logger.warn(
        `shipment_cancelled_after_dispatch shipmentId=${shipmentId} orderId=${shipment.orderId} ` +
          `- the dispatch notification had already run for this shipment. OpenLinker sends no ` +
          `marketplace event to withdraw it, because the only cancellation event it has means ` +
          `the buyer's ORDER was cancelled. Settle the notification with the channel by hand.`,
      );
    }

    return { shipment: cancelled, cancelledAfterDispatch };
  }
}
