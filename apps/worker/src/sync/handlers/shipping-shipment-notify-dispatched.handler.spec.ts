/**
 * Shipping Shipment Notify-Dispatched Handler — Unit Tests (#3365)
 *
 * The handler owns no business rule — the at-most-once gate and the advance
 * live in `ShipmentDispatchNotificationService`. What it owns, and what this
 * file pins, is the one decision that made the automatic path strictly worse
 * than the button it replaced if it went the other way: **which results retry**.
 *
 * `notifyDispatched` does NOT rethrow a marketplace failure. It catches it and
 * reports `outcome: 'notified', source: 'failed'`, deliberately, so it can
 * leave the shipment at `generated`. A handler that reads only `outcome` sees
 * a success, marks the job succeeded, spends its globally-unique idempotency
 * key, and the order is never marked sent with nothing anywhere saying so.
 *
 * @module apps/worker/src/sync/handlers
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import type { IShipmentDispatchNotificationService } from '@openlinker/core/shipping';
import { ShippingShipmentNotifyDispatchedHandler } from './shipping-shipment-notify-dispatched.handler';

describe('ShippingShipmentNotifyDispatchedHandler (#3365)', () => {
  let handler: ShippingShipmentNotifyDispatchedHandler;
  let notification: jest.Mocked<IShipmentDispatchNotificationService>;

  function makeJob(payload: unknown = { schemaVersion: 1, shipmentId: 'ol_shipment_1' }): SyncJob {
    return {
      id: 'job-1',
      jobType: 'shipping.shipment.notifyDispatched',
      connectionId: 'conn-carrier',
      payload,
    } as unknown as SyncJob;
  }

  beforeEach(() => {
    notification = {
      notifyDispatched: jest.fn(),
    } as unknown as jest.Mocked<IShipmentDispatchNotificationService>;
    handler = new ShippingShipmentNotifyDispatchedHandler(notification);
  });

  it('THROWS when the order source could not be reached, so the job retries', async () => {
    // The service leaves the shipment at `generated` on this outcome, so a
    // retry re-reads it, passes the status gate and relays again.
    notification.notifyDispatched.mockResolvedValue({
      shipmentId: 'ol_shipment_1',
      outcome: 'notified',
      source: 'failed',
      destinations: [],
    });

    await expect(handler.execute(makeJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('does NOT throw when only a DESTINATION failed', async () => {
    // The source succeeded, so the shipment HAS advanced; a retry would be
    // stopped by the status gate and accomplish nothing but burning the ladder.
    notification.notifyDispatched.mockResolvedValue({
      shipmentId: 'ol_shipment_1',
      outcome: 'notified',
      source: 'ok',
      destinations: [{ connectionId: 'dest-a', status: 'failed' }],
    } as never);

    await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('does NOT throw when there was no source to notify', async () => {
    // `absent` means nobody to tell, which is a correct end, not a failure.
    notification.notifyDispatched.mockResolvedValue({
      shipmentId: 'ol_shipment_1',
      outcome: 'notified',
      source: 'absent',
      destinations: [],
    });

    await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it.each(['skipped-not-generated', 'shipment-not-found', 'skipped-inbound'] as const)(
    'treats %s as a clean end — no retry can change any of them',
    async (outcome) => {
      notification.notifyDispatched.mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome,
        source: 'absent',
        destinations: [],
      });

      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
    },
  );

  it('wraps a thrown service error rather than letting it escape raw', async () => {
    notification.notifyDispatched.mockRejectedValue(new Error('redis is gone'));

    await expect(handler.execute(makeJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('refuses a payload with no shipmentId instead of calling the service', async () => {
    await expect(handler.execute(makeJob({ schemaVersion: 1 }))).rejects.toBeInstanceOf(
      SyncJobExecutionError,
    );
    expect(notification.notifyDispatched).not.toHaveBeenCalled();
  });
});
