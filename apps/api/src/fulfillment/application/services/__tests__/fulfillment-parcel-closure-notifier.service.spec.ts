/**
 * Fulfilment Parcel Closure Notifier — unit specs (#3525)
 *
 * Covers the whole of the notifier's own contract: it records a `'shipped'`
 * progress event, then routes the resulting `dispatch` intent through
 * whichever relay path applies — the shipment-grain
 * `IShipmentDispatchNotificationService.notifyDispatched` when the work has
 * exactly one linked outbound `generated` shipment (the review correction:
 * tracking number + carrier, and it advances the shipment), or the
 * pre-existing work-grain `IFulfillmentDispatchRelayService.relayDispatch`
 * otherwise — and NEVER throws, the property `BenchParcelService.verifyUnit`
 * and `FulfillmentWorkController.applyAction` both depend on without a
 * try/catch of their own.
 *
 * @module apps/api/src/fulfillment/application/services/__tests__
 */
import type { IFulfillmentProgressService, IFulfillmentRelayGateService } from '@openlinker/core/fulfillment';
import type { IFulfillmentDispatchRelayService } from '@openlinker/core/orders';
import type {
  IShipmentDispatchNotificationService,
  IShipmentQueryService,
  Shipment,
} from '@openlinker/core/shipping';

import { FulfillmentParcelClosureNotifierService } from '../fulfillment-parcel-closure-notifier.service';

const WORK_ID = 'ol_fulfillmentwork_1';
const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';
const CLOSED_AT = new Date('2026-09-04T10:00:00Z');

const shipment = (overrides: Partial<Shipment> = {}): Shipment =>
  ({
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-carrier',
    status: 'generated',
    ...overrides,
  }) as unknown as Shipment;

function harness(options: {
  progress?: jest.Mock;
  relay?: jest.Mock;
  markRelayedExternally?: jest.Mock;
  findByFulfillmentWorkIds?: jest.Mock;
  notifyDispatched?: jest.Mock;
}) {
  const progress = {
    record:
      options.progress ??
      jest.fn().mockResolvedValue({
        status: 'recorded',
        intents: [{ kind: 'dispatch', workId: WORK_ID }],
      }),
  } as unknown as jest.Mocked<IFulfillmentProgressService>;

  const relay = {
    relayDispatch: options.relay ?? jest.fn().mockResolvedValue({ status: 'relayed' }),
  } as unknown as jest.Mocked<IFulfillmentDispatchRelayService>;

  const relayGate = {
    claimDispatch: jest.fn(),
    releaseDispatch: jest.fn(),
    markRelayedExternally: options.markRelayedExternally ?? jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IFulfillmentRelayGateService>;

  // Default: no linked shipment at all — every PRE-EXISTING test relies on
  // this falling straight through to the work-grain relay, unchanged.
  const shipments = {
    findByFulfillmentWorkIds: options.findByFulfillmentWorkIds ?? jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<IShipmentQueryService>;

  const shipmentDispatchNotification = {
    notifyDispatched:
      options.notifyDispatched ??
      jest.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'ok',
        destinations: [],
      }),
  } as unknown as jest.Mocked<IShipmentDispatchNotificationService>;

  return {
    service: new FulfillmentParcelClosureNotifierService(
      progress,
      relay,
      relayGate,
      shipments,
      shipmentDispatchNotification
    ),
    progress,
    relay,
    relayGate,
    shipments,
    shipmentDispatchNotification,
  };
}

describe('FulfillmentParcelClosureNotifierService (#3525)', () => {
  it('records a `shipped` event keyed by the closing instant, never `closed`', async () => {
    const { service, progress } = harness({});

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

    expect(progress.record).toHaveBeenCalledWith({
      kind: 'shipped',
      workId: WORK_ID,
      connectionId: CONNECTION_ID,
      idempotencyKey: `parcel-closed:${WORK_ID}:${String(CLOSED_AT.getTime())}`,
      occurredAt: CLOSED_AT,
    });
  });

  it('forwards the reported `dispatch` intent to the WORK-GRAIN relay when no shipment is linked', async () => {
    const { service, relay } = harness({});

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

    expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
  });

  it('mints a DIFFERENT key for a reopen-then-reclose, so the second close is not deduplicated away', async () => {
    const { service, progress } = harness({});
    const secondClose = new Date('2026-09-04T11:30:00Z');

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });
    await service.notifyParcelClosed({
      workId: WORK_ID,
      connectionId: CONNECTION_ID,
      closedAt: secondClose,
    });

    const keys = progress.record.mock.calls.map((call) => call[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('does NOT relay a `duplicate` progress outcome', async () => {
    const { service, relay } = harness({
      progress: jest.fn().mockResolvedValue({ status: 'duplicate' }),
    });

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

    expect(relay.relayDispatch).not.toHaveBeenCalled();
  });

  it('does NOT relay an `unknown-work` progress outcome', async () => {
    const { service, relay } = harness({
      progress: jest.fn().mockResolvedValue({ status: 'unknown-work', workId: WORK_ID }),
    });

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

    expect(relay.relayDispatch).not.toHaveBeenCalled();
  });

  it('never throws when the progress record itself throws', async () => {
    const { service } = harness({
      progress: jest.fn().mockRejectedValue(new Error('db unavailable')),
    });

    await expect(
      service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT })
    ).resolves.toBeUndefined();
  });

  it('never throws when the work-grain relay itself throws', async () => {
    const { service } = harness({
      relay: jest.fn().mockRejectedValue(new Error('adapter unresolved')),
    });

    await expect(
      service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT })
    ).resolves.toBeUndefined();
  });

  it('leaves a `released` (transient) relay outcome for the #2728 reconcile sweep, without retrying itself', async () => {
    const relay = jest.fn().mockResolvedValue({ status: 'released', reason: 'adapter-unresolved' });
    const { service } = harness({ relay });

    await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

    // Called exactly once — no synchronous retry loop.
    expect(relay).toHaveBeenCalledTimes(1);
  });

  /**
   * The review correction: for the ordinary `ol_managed_carrier` case (a
   * bought label, #2402's `fulfillmentWorkId` link, still `generated`), the
   * work-grain relay would tell the channel "dispatched" with no tracking
   * number and never advance the shipment. The shipment-grain path fixes
   * both, and the work-grain relay must not ALSO fire behind it.
   */
  describe('exactly one linked generated shipment (#3525 review)', () => {
    it('drives notifyDispatched instead of the work-grain relay', async () => {
      const findByFulfillmentWorkIds = jest
        .fn()
        .mockResolvedValue(new Map([[WORK_ID, [shipment({ id: 'ol_shipment_42' })]]]));
      const { service, shipmentDispatchNotification, relay } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(shipmentDispatchNotification.notifyDispatched).toHaveBeenCalledWith({
        shipmentId: 'ol_shipment_42',
      });
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('claims the work-grain slot WITHOUT relaying, once the shipment-grain notify lands', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const { service, relayGate } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(relayGate.markRelayedExternally).toHaveBeenCalledWith(WORK_ID);
    });

    it('reads only the OUTBOUND direction (never a return label, #2373)', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const { service } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(findByFulfillmentWorkIds).toHaveBeenCalledWith([WORK_ID], 'outbound');
    });

    it('ignores a shipment that is not `generated` — falls back to the work-grain relay', async () => {
      const findByFulfillmentWorkIds = jest
        .fn()
        .mockResolvedValue(new Map([[WORK_ID, [shipment({ status: 'dispatched' })]]]));
      const { service, relay, shipmentDispatchNotification } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(shipmentDispatchNotification.notifyDispatched).not.toHaveBeenCalled();
      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it('falls back to the work-grain relay when MORE THAN ONE generated shipment is linked (split order, ambiguous)', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(
        new Map([[WORK_ID, [shipment({ id: 'a' }), shipment({ id: 'b' })]]])
      );
      const { service, relay, shipmentDispatchNotification } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(shipmentDispatchNotification.notifyDispatched).not.toHaveBeenCalled();
      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it('falls back to the work-grain relay when the shipment lookup itself throws', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockRejectedValue(new Error('db unavailable'));
      const { service, relay } = harness({ findByFulfillmentWorkIds });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(relay.relayDispatch).toHaveBeenCalledWith({ kind: 'dispatch', workId: WORK_ID });
    });

    it('a notifyDispatched FAILURE takes no claim and does NOT fall back to the work-grain relay in the same call', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const notifyDispatched = jest.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'failed',
        destinations: [],
      });
      const { service, relayGate, relay } = harness({ findByFulfillmentWorkIds, notifyDispatched });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
      // Deliberately NOT a fallback — see the service's own header. The
      // shipment stays `generated` (retriable) and the work-grain slot stays
      // open for a later event or an operator's manual notify.
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('a `skipped-not-generated` / `shipment-not-found` outcome is treated the same as a failure — no claim, no fallback', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const notifyDispatched = jest.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'skipped-not-generated',
        source: 'absent',
        destinations: [],
      });
      const { service, relayGate, relay } = harness({ findByFulfillmentWorkIds, notifyDispatched });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('never throws when notifyDispatched itself throws', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const notifyDispatched = jest.fn().mockRejectedValue(new Error('carrier http 500'));
      const { service, relayGate, relay } = harness({ findByFulfillmentWorkIds, notifyDispatched });

      await expect(
        service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT })
      ).resolves.toBeUndefined();
      expect(relayGate.markRelayedExternally).not.toHaveBeenCalled();
      expect(relay.relayDispatch).not.toHaveBeenCalled();
    });

    it('an `absent` source (no marketplace source) still counts as told, and claims the slot', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const notifyDispatched = jest.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'absent',
        destinations: [],
      });
      const { service, relayGate } = harness({ findByFulfillmentWorkIds, notifyDispatched });

      await service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT });

      expect(relayGate.markRelayedExternally).toHaveBeenCalledWith(WORK_ID);
    });

    it('a lost claim race (a peer already holds the slot) is not an error', async () => {
      const findByFulfillmentWorkIds = jest.fn().mockResolvedValue(new Map([[WORK_ID, [shipment()]]]));
      const { service } = harness({
        findByFulfillmentWorkIds,
        markRelayedExternally: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt: CLOSED_AT })
      ).resolves.toBeUndefined();
    });
  });
});
