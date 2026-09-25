/**
 * Shipping Shipment Notify-Dispatched Handler (#3365)
 *
 * Tells the order's source marketplace and its destination shops that a parcel
 * shipped, without waiting for a human to press "Mark dispatched".
 *
 * `ShipmentDispatchService` enqueues one of these the moment a label is bought
 * - on the operator's own dispatch AND on the automatic one, since both reach
 * the same `dispatch()`. Before this, `IShipmentDispatchNotificationService`
 * had exactly one caller, `POST /shipments/:id/notify-dispatched`, so a
 * marketplace learned a tracking number only if somebody clicked, and a label
 * bought by `fulfillment.work.autoDispatch` told nobody at all.
 *
 * Idempotent against that button by construction: the notification service
 * gates on the shipment still being `generated` and advances it to
 * `dispatched` itself, so whichever of the two arrives second answers
 * `skipped-not-generated` and writes nothing.
 *
 * A non-`notified` outcome is `ok`, not a failure. `shipment-not-found`
 * (deleted between enqueue and run) and `skipped-not-generated` (the operator
 * got there first, or the poll already terminalised the row) are both correct
 * ends for this job, and retrying either would burn the ladder on a state no
 * retry can change. Only a THROWN error retries - that is the transient
 * marketplace failure this job exists to survive.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ShippingShipmentNotifyDispatchedPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IShipmentDispatchNotificationService,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class ShippingShipmentNotifyDispatchedHandler implements SyncJobHandler {
  private readonly logger = new Logger(ShippingShipmentNotifyDispatchedHandler.name);

  constructor(
    @Inject(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
    private readonly notification: IShipmentDispatchNotificationService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const { shipmentId } = this.getPayload(job);

    try {
      const result = await this.notification.notifyDispatched({ shipmentId });

      if (result.outcome !== 'notified') {
        this.logger.log(
          `shipping.shipment.notifyDispatched job ${job.id}: nothing to do for shipment ` +
            `${shipmentId} (outcome=${result.outcome}) - already notified, already terminal, ` +
            `or the shipment is gone.`,
        );
        return { outcome: 'ok' };
      }

      const destinations = result.destinations
        .map((destination) => `${destination.connectionId}=${destination.status}`)
        .join(',');
      this.logger.log(
        `shipping.shipment.notifyDispatched job ${job.id}: shipment ${shipmentId} ` +
          `source=${result.source} destinations=[${destinations}]`,
      );
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Shipment dispatch notification failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): ShippingShipmentNotifyDispatchedPayloadV1 {
    const payload = job.payload as unknown as Partial<ShippingShipmentNotifyDispatchedPayloadV1>;
    if (!payload || typeof payload !== 'object' || typeof payload.shipmentId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid payload (shipmentId) for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return { schemaVersion: 1, shipmentId: payload.shipmentId };
  }
}
