/**
 * Fulfilment Parcel Closure Notifier — unit specs (#3525, #3506)
 *
 * Covers the notifier's own contract: it records a `'shipped'` progress event,
 * then hands the resulting `dispatch` intent to the shared shipment-first
 * router (`IFulfillmentWorkDispatchRouterService`) — and NEVER throws, the
 * property `BenchParcelService.verifyUnit` and
 * `FulfillmentWorkController.applyAction` both depend on without a try/catch
 * of their own.
 *
 * Which relay path a work takes (shipment-grain vs work-grain) is the
 * router's decision since #3506 and is pinned by
 * `fulfillment-work-dispatch-router.service.spec.ts`, not re-asserted here.
 *
 * @module apps/api/src/fulfillment/application/services/__tests__
 */
import type { IFulfillmentProgressService } from '@openlinker/core/fulfillment';
import type { IFulfillmentWorkDispatchRouterService } from '@openlinker/core/shipping';

import { FulfillmentParcelClosureNotifierService } from '../fulfillment-parcel-closure-notifier.service';

const WORK_ID = 'ol_fulfillmentwork_1';
const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';
const CLOSED_AT = new Date('2026-09-04T10:00:00Z');

function harness(options: { progress?: jest.Mock; routeDispatch?: jest.Mock }) {
  const progress = {
    record:
      options.progress ??
      jest.fn().mockResolvedValue({
        status: 'recorded',
        intents: [{ kind: 'dispatch', workId: WORK_ID }],
      }),
  } as unknown as jest.Mocked<IFulfillmentProgressService>;

  const router = {
    routeDispatch: options.routeDispatch ?? jest.fn().mockResolvedValue({ status: 'relayed' }),
  } as unknown as jest.Mocked<IFulfillmentWorkDispatchRouterService>;

  const service = new FulfillmentParcelClosureNotifierService(progress, router);
  const warn = jest
    .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
    .mockImplementation(() => undefined);

  return { service, progress, router, warn };
}

const close = (service: FulfillmentParcelClosureNotifierService, closedAt = CLOSED_AT) =>
  service.notifyParcelClosed({ workId: WORK_ID, connectionId: CONNECTION_ID, closedAt });

describe('FulfillmentParcelClosureNotifierService (#3525)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should record a `shipped` event keyed by the closing instant when a parcel closes, never `closed`', async () => {
    const { service, progress } = harness({});

    await close(service);

    expect(progress.record).toHaveBeenCalledWith({
      kind: 'shipped',
      workId: WORK_ID,
      connectionId: CONNECTION_ID,
      idempotencyKey: `parcel-closed:${WORK_ID}:${String(CLOSED_AT.getTime())}`,
      occurredAt: CLOSED_AT,
    });
  });

  it('should hand the reported `dispatch` intent to the shipment-first router when the record reports one', async () => {
    const { service, router } = harness({});

    await close(service);

    expect(router.routeDispatch).toHaveBeenCalledWith(WORK_ID);
    expect(router.routeDispatch).toHaveBeenCalledTimes(1);
  });

  it('should ignore an intent that is not `dispatch` when the record reports one', async () => {
    const { service, router } = harness({
      progress: jest.fn().mockResolvedValue({
        status: 'recorded',
        intents: [{ kind: 'reroute', workId: WORK_ID }],
      }),
    });

    await close(service);

    expect(router.routeDispatch).not.toHaveBeenCalled();
  });

  it('should mint a DIFFERENT key when a work is reopened and reclosed, so the second close is not deduplicated away', async () => {
    const { service, progress } = harness({});

    await close(service);
    await close(service, new Date('2026-09-04T11:30:00Z'));

    const keys = progress.record.mock.calls.map((call) => call[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('should not route when the progress outcome is `duplicate`', async () => {
    const { service, router } = harness({
      progress: jest.fn().mockResolvedValue({ status: 'duplicate' }),
    });

    await close(service);

    expect(router.routeDispatch).not.toHaveBeenCalled();
  });

  it('should not route when the progress outcome is `unknown-work`', async () => {
    const { service, router } = harness({
      progress: jest.fn().mockResolvedValue({ status: 'unknown-work', workId: WORK_ID }),
    });

    await close(service);

    expect(router.routeDispatch).not.toHaveBeenCalled();
  });

  it('should never throw when the progress record itself throws', async () => {
    const { service } = harness({
      progress: jest.fn().mockRejectedValue(new Error('db unavailable')),
    });

    await expect(close(service)).resolves.toBeUndefined();
  });

  it('should never throw when the router itself throws', async () => {
    const { service } = harness({
      routeDispatch: jest.fn().mockRejectedValue(new Error('claim read exploded')),
    });

    await expect(close(service)).resolves.toBeUndefined();
  });

  it.each([
    [{ status: 'released', reason: 'adapter-unresolved' }],
    [{ status: 'shipment-failed', shipmentId: 'ol_shipment_1', reason: 'source=failed' }],
  ])(
    'should leave a %o outcome for the reconcile sweep without retrying it itself',
    async (outcome) => {
      const routeDispatch = jest.fn().mockResolvedValue(outcome);
      const { service, warn } = harness({ routeDispatch });

      await close(service);

      // Called exactly once — no synchronous retry loop; the slot is open, so
      // `fulfillment.work.relaySweep` owns the retry.
      expect(routeDispatch).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.some((call) => String(call[0]).includes('relaySweep'))).toBe(true);
    }
  );

  it.each([
    [{ status: 'via-shipment', shipmentId: 'ol_shipment_1' }],
    [{ status: 'relayed' }],
    [{ status: 'already-relayed' }],
  ])('should stay quiet when the route outcome is the steady state %o', async (outcome) => {
    const { service, warn } = harness({ routeDispatch: jest.fn().mockResolvedValue(outcome) });

    await close(service);

    expect(warn).not.toHaveBeenCalled();
  });
});
