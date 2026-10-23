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
 * (deleted between enqueue and run), `skipped-not-generated` (the operator got
 * there first, or the poll already terminalised the row) and `skipped-inbound`
 * (a return parcel, #2373) are all correct ends for this job, and retrying any
 * of them would burn the ladder on a state no retry can change.
 *
 * **A `notified` outcome is NOT automatically a success**, and the previous
 * wording here - "Only a THROWN error retries - that is the transient
 * marketplace failure this job exists to survive" - was wrong about its own
 * subject. The notification service does not throw a marketplace failure: it
 * catches it and reports `source: 'failed'`, precisely so it can leave the
 * shipment at `generated`. So the failure class this job was built for arrived
 * as `notified` + `source: 'failed'` and was returned as `ok`. The handler now
 * throws on it; see the comment at the check itself for why retrying is safe
 * and why a DESTINATION failure deliberately does not.
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

    // The try wraps ONLY the service call. A decision this handler makes about
    // a returned result must not be re-wrapped by the catch below, which would
    // bury it under "Shipment dispatch notification failed: ...".
    let result: Awaited<ReturnType<IShipmentDispatchNotificationService['notifyDispatched']>>;
    try {
      result = await this.notification.notifyDispatched({ shipmentId });
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

    {
      if (result.outcome !== 'notified') {
        this.logger.log(
          `shipping.shipment.notifyDispatched job ${job.id}: nothing to do for shipment ` +
            `${shipmentId} (outcome=${result.outcome}) - already notified, already terminal, ` +
            `the shipment is gone, or it is an inbound (return) parcel.`,
        );
        return { outcome: 'ok' };
      }

      const destinations = result.destinations
        .map((destination) => `${destination.connectionId}=${destination.status}`)
        .join(',');

      // A FAILED source must retry, and getting this wrong made the job
      // strictly worse than the button it replaced.
      //
      // `notifyDispatched` does not rethrow a marketplace failure - it catches
      // it and reports `source: 'failed'`, deliberately, so it can leave the
      // shipment at `generated` rather than advancing past its own at-most-once
      // gate (the service says so in as many words at its `if (source === 'ok'
      // || source === 'absent')`: "A source failed/rejected leaves generated ->
      // retriable"). So an `outcome: 'notified'` with `source: 'failed'` IS the
      // transient marketplace failure this job exists to survive, and returning
      // `ok` for it marked the job succeeded, spent its globally-unique
      // idempotency key, and left the order never marked sent with nothing
      // anywhere saying so.
      //
      // Retrying is safe because the shipment is still `generated`: the re-run
      // re-reads it, passes the status gate and relays again. If the relay then
      // succeeds the row advances and any later duplicate is stopped by that
      // same gate.
      //
      // DESTINATION failures deliberately do NOT throw. The source succeeded,
      // so the shipment HAS advanced to `dispatched`, and a retry would be
      // stopped by the status gate and accomplish nothing but burning the
      // ladder. That asymmetry is a real gap - the polling path records a
      // durable per-participant failure for the same event and this path
      // records none - and it is #861's, not this handler's to invent.
      if (result.source === 'failed') {
        throw new SyncJobExecutionError(
          `Shipment dispatch notification could not reach the order source for shipment ` +
            `${shipmentId} (destinations=[${destinations}]); the shipment is still 'generated' ` +
            `and this job will retry.`,
          job.id,
          job.jobType,
          job.connectionId,
        );
      }

      this.logger.log(
        `shipping.shipment.notifyDispatched job ${job.id}: shipment ${shipmentId} ` +
          `source=${result.source} destinations=[${destinations}]`,
      );
      return { outcome: 'ok' };
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
