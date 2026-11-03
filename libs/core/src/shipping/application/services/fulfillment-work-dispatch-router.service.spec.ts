/**
 * FulfillmentWorkDispatchRouterService — unit spec (#3506, G02-4)
 *
 * Pins the shipment-first routing decision both callers (the parcel-closure
 * notifier and the `fulfillment.work.relaySweep` reconcile pass) now share:
 *
 * - one linked outbound `generated` shipment → the shipment-grain notify, and
 *   the work-grain slot is claimed WITHOUT relaying;
 * - a shipment-grain failure → `shipment-failed`, no claim, and NO fallback to
 *   the tracking-less work-grain relay (the fallback is the G02-4 defect);
 * - zero / several generated shipments, or a failed lookup → the work-grain
 *   relay, its outcome passed through unchanged.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IFulfillmentRelayGateService } from '@openlinker/core/fulfillment';
import type { IFulfillmentDispatchRelayService } from '@openlinker/core/orders';

import type { IShipmentDispatchNotificationService } from '../interfaces/shipment-dispatch-notification.service.interface';
import type { IShipmentQueryService } from '../interfaces/shipment-query.service.interface';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { FulfillmentWorkDispatchRouterService } from './fulfillment-work-dispatch-router.service';

const WORK_ID = 'ol_fulfillmentwork_1';

const shipment = (overrides: Partial<Shipment> = {}): Shipment =>
  ({
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-carrier',
    status: 'generated',
    ...overrides,
  }) as unknown as Shipment;

function harness(options: {
  relayDispatch?: jest.Mock;
  markRelayedExternally?: jest.Mock;
  findByFulfillmentWorkIds?: jest.Mock;
  notifyDispatched?: jest.Mock;
}) {
  const relay = {
    relayDispatch: options.relayDispatch ?? jest.fn().mockResolvedValue({ status: 'relayed' }),
  } as unknown as jest.Mocked<IFulfillmentDispatchRelayService>;

  const relayGate = {
    claimDispatch: jest.fn(),
    releaseDispatch: jest.fn(),
    markRelayedExternally: options.markRelayedExternally ?? jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IFulfillmentRelayGateService>;

  const shipments = {
    findByFulfillmentWorkIds:
      options.findByFulfillmentWorkIds ?? jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<IShipmentQueryService>;

  const notification = {
    notifyDispatched:
      options.notifyDispatched ??
      jest.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'ok',
        destinations: [],
      }),
  } as unknown as jest.Mocked<IShipmentDispatchNotificationService>;

  const service = new FulfillmentWorkDispatchRouterService(
    relay,
    relayGate,
    shipments,
    notification
  );
  const logger = (service as unknown as { logger: Record<string, unknown> }).logger;
  jest.spyOn(logger as { warn: () => void }, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger as { debug: () => void }, 'debug').mockImplementation(() => undefined);

  return { service, relay, relayGate, shipments, notification };
}

const linkedTo = (...linked: Shipment[]) =>
  jest.fn().mockResolvedValue(new Map([[WORK_ID, linked]]));

describe('FulfillmentWorkDispatchRouterService (#3506)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('exactly one linked generated shipment', () => {
    it('should notify through the shipment and claim the slot without relaying when the notify lands', async () => {
      const { service, notification, relayGate, relay } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment({ id: 'ol_shipment_42' })),
      });

      const outcome = await service.routeDispatch(WORK_ID);

      expect(outcome).toEqual({ status: 'via-shipment', shipmentId: 'ol_shipment_42' });
      expect(notification.notifyDispatched).toHaveBeenCalledWith({ shipmentId: 'ol_shipment_42' });
      expect(relayGate.markRelayedExternally).toHaveBeenCalledWith(WORK_ID);
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('should read only the OUTBOUND direction when it looks up the linked shipment (never a return label, #2373)', async () => {
      const findByFulfillmentWorkIds = linkedTo(shipment());
      const { service } = harness({ findByFulfillmentWorkIds });

      await service.routeDispatch(WORK_ID);

      expect(findByFulfillmentWorkIds).toHaveBeenCalledWith([WORK_ID], 'outbound');
    });

    it('should count an `absent` source as told when the order has no marketplace source', async () => {
      const { service, relayGate } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment()),
        notifyDispatched: jest.fn().mockResolvedValue({
          shipmentId: 'ol_shipment_1',
          outcome: 'notified',
          source: 'absent',
          destinations: [],
        }),
      });

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual({
        status: 'via-shipment',
        shipmentId: 'ol_shipment_1',
      });
      expect(relayGate.markRelayedExternally).toHaveBeenCalledWith(WORK_ID);
    });

    it('should still report via-shipment when a peer already holds the slot', async () => {
      const { service } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment()),
        markRelayedExternally: jest.fn().mockResolvedValue(false),
      });

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual({
        status: 'via-shipment',
        shipmentId: 'ol_shipment_1',
      });
    });

    it('should still report via-shipment when the slot claim throws after the channel was told', async () => {
      const { service, relay } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment()),
        markRelayedExternally: jest.fn().mockRejectedValue(new Error('db blip')),
      });

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual({
        status: 'via-shipment',
        shipmentId: 'ol_shipment_1',
      });
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('should report shipment-failed without claiming or falling back when the source rejects the notify', async () => {
      const { service, relayGate, relay } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment()),
        notifyDispatched: jest.fn().mockResolvedValue({
          shipmentId: 'ol_shipment_1',
          outcome: 'notified',
          source: 'failed',
          destinations: [],
        }),
      });

      const outcome = await service.routeDispatch(WORK_ID);

      expect(outcome).toEqual({
        status: 'shipment-failed',
        shipmentId: 'ol_shipment_1',
        reason: 'outcome=notified, source=failed',
      });
      expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
      // THE G02-4 regression guard: a tracking-less work-grain relay here burns
      // the slot and the buyer never receives the waybill.
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it.each(['skipped-not-generated', 'shipment-not-found'] as const)(
      'should report shipment-failed without claiming or falling back when the notify answers %s',
      async (notifyOutcome) => {
        const { service, relayGate, relay } = harness({
          findByFulfillmentWorkIds: linkedTo(shipment()),
          notifyDispatched: jest.fn().mockResolvedValue({
            shipmentId: 'ol_shipment_1',
            outcome: notifyOutcome,
            source: 'absent',
            destinations: [],
          }),
        });

        await expect(service.routeDispatch(WORK_ID)).resolves.toMatchObject({
          status: 'shipment-failed',
        });
        expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
        expect(relay.relayDispatch).not.toHaveBeenCalled();
      }
    );

    it('should report shipment-failed without throwing when the notify itself throws', async () => {
      const { service, relayGate, relay } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment()),
        notifyDispatched: jest.fn().mockRejectedValue(new Error('carrier http 500')),
      });

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual({
        status: 'shipment-failed',
        shipmentId: 'ol_shipment_1',
        reason: 'threw: carrier http 500',
      });
      expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });
  });

  describe('no single linked generated shipment — the work-grain relay', () => {
    it('should use the work-grain relay when no shipment is linked', async () => {
      const { service, relay, notification } = harness({});

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual({ status: 'relayed' });

      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
      expect(notification.notifyDispatched).not.toHaveBeenCalled();
    });

    it('should ignore a linked shipment that is no longer generated when it routes', async () => {
      const { service, relay, notification } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment({ status: 'dispatched' })),
      });

      await service.routeDispatch(WORK_ID);

      expect(notification.notifyDispatched).not.toHaveBeenCalled();
      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it('should use the work-grain relay when MORE THAN ONE generated shipment is linked (split order, ambiguous)', async () => {
      const { service, relay, notification } = harness({
        findByFulfillmentWorkIds: linkedTo(shipment({ id: 'a' }), shipment({ id: 'b' })),
      });

      await service.routeDispatch(WORK_ID);

      expect(notification.notifyDispatched).not.toHaveBeenCalled();
      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it('should fall back to the work-grain relay when the shipment lookup throws', async () => {
      const { service, relay } = harness({
        findByFulfillmentWorkIds: jest.fn().mockRejectedValue(new Error('db unavailable')),
      });

      await service.routeDispatch(WORK_ID);

      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it.each([
      [{ status: 'released', reason: 'adapter-unresolved' }],
      [{ status: 'already-relayed' }],
      [{ status: 'unknown-work', workId: WORK_ID }],
    ])('should pass the work-grain outcome %o through unchanged', async (relayOutcome) => {
      const { service } = harness({ relayDispatch: jest.fn().mockResolvedValue(relayOutcome) });

      await expect(service.routeDispatch(WORK_ID)).resolves.toEqual(relayOutcome);
    });

    it('should propagate a work-grain relay throw so the caller can count it', async () => {
      const { service } = harness({
        relayDispatch: jest.fn().mockRejectedValue(new Error('claim read exploded')),
      });

      await expect(service.routeDispatch(WORK_ID)).rejects.toThrow('claim read exploded');
    });
  });
});
