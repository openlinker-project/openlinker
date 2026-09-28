/**
 * Fulfilment Parcel Closure Notifier — unit specs (#3525)
 *
 * Covers the whole of the notifier's own contract: it records a `'shipped'`
 * progress event, forwards the resulting `dispatch` intent, and NEVER throws
 * — the property `BenchParcelService.verifyUnit` and
 * `FulfillmentWorkController.applyAction` both depend on without a try/catch
 * of their own.
 *
 * @module apps/api/src/fulfillment/application/services/__tests__
 */
import type { IFulfillmentProgressService } from '@openlinker/core/fulfillment';
import type { IFulfillmentDispatchRelayService } from '@openlinker/core/orders';

import { FulfillmentParcelClosureNotifierService } from '../fulfillment-parcel-closure-notifier.service';

const WORK_ID = 'ol_fulfillmentwork_1';
const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';
const CLOSED_AT = new Date('2026-09-04T10:00:00Z');

function harness(options: {
  progress?: jest.Mock;
  relay?: jest.Mock;
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

  return { service: new FulfillmentParcelClosureNotifierService(progress, relay), progress, relay };
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

  it('forwards the reported `dispatch` intent to the relay', async () => {
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

  it('never throws when the relay itself throws', async () => {
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
});
