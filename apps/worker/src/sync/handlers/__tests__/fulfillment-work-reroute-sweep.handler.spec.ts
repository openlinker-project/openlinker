/**
 * FulfillmentWorkRerouteSweepHandler — unit spec (#3485)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';

import {
  FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY,
  FulfillmentWorkRerouteSweepHandler,
  buildRerouteRouteJobKey,
  fulfillmentRerouteSweepLockKey,
} from '../fulfillment-work-reroute-sweep.handler';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const TICK = '2026-09-25T10:07:00.000Z';

/** A connection claiming A2 (`config-only`, so capability lists are irrelevant). */
const routerConnection = (id: string): Record<string, unknown> => ({
  id,
  status: 'active',
  enabledCapabilities: [],
  config: { sourcingAuthority: { enabled: true } },
});

describe('FulfillmentWorkRerouteSweepHandler (#3485)', () => {
  let orderRecords: { listOrderIdsByFulfillmentBlockReasons: jest.Mock };
  let connections: { list: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let configService: { get: jest.Mock };
  let handler: FulfillmentWorkRerouteSweepHandler;

  const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.rerouteSweep' as unknown as SyncJob['jobType'],
      connectionId: SYSTEM,
      createdAt: new Date(TICK),
      payload,
    }) as unknown as SyncJob;

  const enqueuedOrderIds = (): string[] =>
    jobEnqueue.enqueueJob.mock.calls.map(
      ([request]) => (request as { payload: { orderId: string } }).payload.orderId
    );

  beforeEach(() => {
    orderRecords = { listOrderIdsByFulfillmentBlockReasons: jest.fn().mockResolvedValue([]) };
    connections = { list: jest.fn().mockResolvedValue([routerConnection('conn-oms')]) };
    cursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursor: jest.fn().mockResolvedValue(undefined),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    syncLock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    handler = new FulfillmentWorkRerouteSweepHandler(
      orderRecords as never,
      connections as never,
      cursors as never,
      jobEnqueue as never,
      syncLock as never,
      configService as never
    );
  });

  it('should name its OWN lock, never the master sweep namespace', () => {
    const key = fulfillmentRerouteSweepLockKey('scope-1');
    expect(key).toBe('fulfillment:work:reroute-sweep:scope-1');
    expect(key.startsWith('master:')).toBe(false);
  });

  it('should skip without reading anything when the lock is held', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
    expect(orderRecords.listOrderIdsByFulfillmentBlockReasons).not.toHaveBeenCalled();
  });

  it('should read only the reroutable reasons, never the address-less hold', async () => {
    await handler.execute(job());

    const [reasons] = orderRecords.listOrderIdsByFulfillmentBlockReasons.mock.calls[0] as [
      string[],
    ];
    expect([...reasons].sort()).toEqual(['routing-failed', 'routing-refused']);
    expect(reasons).not.toContain('routing-no-shipping-address');
  });

  // #2609: the child route job must carry the ROUTER's connection, never the
  // synthetic system id the sweep itself runs under.
  it('should enqueue one route job per held order under the selected router', async () => {
    orderRecords.listOrderIdsByFulfillmentBlockReasons.mockResolvedValue([
      'ol_order_a',
      'ol_order_b',
    ]);

    await handler.execute(job());

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'fulfillment.work.route',
      connectionId: 'conn-oms',
      payload: { schemaVersion: 1, orderId: 'ol_order_a' },
      idempotencyKey: buildRerouteRouteJobKey('ol_order_a', TICK),
    });
  });

  it('should page after the stored cursor and advance it to the last id of a full page', async () => {
    cursors.getCursor.mockResolvedValue('ol_order_m');
    orderRecords.listOrderIdsByFulfillmentBlockReasons.mockResolvedValue([
      'ol_order_n',
      'ol_order_o',
    ]);

    await handler.execute(job({ schemaVersion: 1, pageLimit: 2 }));

    expect(orderRecords.listOrderIdsByFulfillmentBlockReasons).toHaveBeenCalledWith(
      expect.any(Array),
      { afterOrderId: 'ol_order_m', limit: 2 }
    );
    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      SYSTEM,
      FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY,
      'ol_order_o'
    );
  });

  // A short page is the end of the set: wrap, so an order still held is retried
  // on the next pass rather than left behind the cursor for ever.
  it('should wrap the cursor to the start on a short page', async () => {
    cursors.getCursor.mockResolvedValue('ol_order_m');
    orderRecords.listOrderIdsByFulfillmentBlockReasons.mockResolvedValue(['ol_order_n']);

    await handler.execute(job({ schemaVersion: 1, pageLimit: 2 }));

    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      SYSTEM,
      FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY,
      ''
    );
  });

  it('should read an empty stored cursor as the start of the set', async () => {
    cursors.getCursor.mockResolvedValue('');

    await handler.execute(job());

    expect(orderRecords.listOrderIdsByFulfillmentBlockReasons).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ afterOrderId: null })
    );
  });

  // The OMS switched off (or an ambiguous claim): nothing can route these
  // orders, and releasing them to the masters is not this pass's decision.
  it.each([
    ['no claimant', []],
    ['an ambiguous claim', [routerConnection('conn-a'), routerConnection('conn-b')]],
  ])('should enqueue nothing and keep the cursor when there is %s', async (_label, list) => {
    connections.list.mockResolvedValue(list);
    orderRecords.listOrderIdsByFulfillmentBlockReasons.mockResolvedValue(['ol_order_a']);

    await handler.execute(job());

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(cursors.advanceCursor).not.toHaveBeenCalled();
  });

  // The cursor moves only once every enqueue in the page landed, so a failed
  // run re-reads the same page instead of skipping the orders it lost.
  it('should not advance the cursor and should fail the job when an enqueue throws', async () => {
    orderRecords.listOrderIdsByFulfillmentBlockReasons.mockResolvedValue([
      'ol_order_a',
      'ol_order_b',
    ]);
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'j1', isExisting: false })
      .mockRejectedValueOnce(new Error('postgres down'));

    await expect(handler.execute(job())).rejects.toThrow('fulfillment.work.rerouteSweep failed');
    expect(cursors.advanceCursor).not.toHaveBeenCalled();
    expect(syncLock.release).toHaveBeenCalled();
  });

  // A retry of the SAME run re-mints identical keys, so it dedupes against the
  // route jobs the first attempt already enqueued; the next tick is a new key.
  it('should key each child per order and per tick', () => {
    expect(buildRerouteRouteJobKey('ol_order_a', TICK)).toBe(
      `fulfillment:work:route:reroute:ol_order_a:${TICK}`
    );
    expect(buildRerouteRouteJobKey('ol_order_a', TICK)).not.toBe(
      buildRerouteRouteJobKey('ol_order_a', '2026-09-25T10:22:00.000Z')
    );
  });

  it('should report ok even when there is nothing to reroute', async () => {
    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
    expect(enqueuedOrderIds()).toEqual([]);
  });
});
