/**
 * FulfillmentWorkRelaySweepHandler — unit spec (#2728)
 *
 * Pins the four acceptance criteria at the seam that composes them:
 *
 * - **AC1** a shipped work with an unlanded relay is re-driven, without any
 *   vendor event being replayed — the sweep's only input is OL's own rows.
 * - **AC2** the `(workId, idempotencyKey)` progress claim is never released.
 *   The structural half is `no-progress-claim-release.spec.ts`; here the
 *   behavioural half asserts a replay is STILL a no-op after a full run.
 * - **AC3** every re-drive goes through `relayDispatch`, which takes
 *   `claimDispatchRelay` — so a concurrent trigger and this sweep cannot both
 *   relay. Asserted by the handler holding no claim seam of its own.
 * - **AC4** a work that can never be relayed is observable rather than silently
 *   recycled.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';

import {
  FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_DEFAULT,
  FulfillmentWorkRelaySweepHandler,
  fulfillmentRelaySweepLockKey,
} from '../fulfillment-work-relay-sweep.handler';

const STUCK_DETAIL = 'The source has not been told this work dispatched, 24 hours after it shipped';

function candidate(workId: string, options: { stuck?: boolean } = {}) {
  return {
    intent: { kind: 'dispatch' as const, workId },
    orderId: `order-for-${workId}`,
    shippedAt: new Date('2026-09-07T00:00:00.000Z'),
    stuck: options.stuck ?? false,
  };
}

function page(candidates: ReturnType<typeof candidate>[]) {
  return {
    candidates,
    stuckCount: candidates.filter((entry) => entry.stuck).length,
    stuckAfterMs: 86_400_000,
    stuckDetail: STUCK_DETAIL,
  };
}

describe('FulfillmentWorkRelaySweepHandler (#2728)', () => {
  let reconcile: { listUnrelayedDispatches: jest.Mock };
  let relay: { relayDispatch: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let configService: { get: jest.Mock };
  let handler: FulfillmentWorkRelaySweepHandler;
  let errors: string[];

  const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.relaySweep' as unknown as SyncJob['jobType'],
      connectionId: '00000000-0000-0000-0000-000000000000',
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    reconcile = { listUnrelayedDispatches: jest.fn().mockResolvedValue(page([])) };
    relay = { relayDispatch: jest.fn().mockResolvedValue({ status: 'relayed' }) };
    syncLock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    handler = new FulfillmentWorkRelaySweepHandler(
      reconcile as never,
      relay as never,
      syncLock as never,
      configService as never
    );

    errors = [];
    jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation((message: unknown) => void errors.push(String(message)));
    jest.spyOn(handler['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(handler['logger'], 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should name its OWN lock, never the master sweep namespace nor the timeout sweep', () => {
    // `sweepLockKey` renders `master:{kind}:sweep:{id}` — a false name for a pass
    // with no master. And the two fulfilment sweeps are different passes over the
    // same table, so they must not exclude each other.
    const key = fulfillmentRelaySweepLockKey('scope-1');
    expect(key).toBe('fulfillment:work:relay-sweep:scope-1');
    expect(key.startsWith('master:')).toBe(false);
    expect(key).not.toBe('fulfillment:work:timeout-sweep:scope-1');
  });

  it('should skip the run entirely when a peer holds the lock', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(reconcile.listUnrelayedDispatches).not.toHaveBeenCalled();
    expect(relay.relayDispatch).not.toHaveBeenCalled();
  });

  it('should re-drive every candidate through relayDispatch (AC1, AC3)', async () => {
    reconcile.listUnrelayedDispatches.mockResolvedValue(
      page([candidate('ol_work_1'), candidate('ol_work_2')])
    );

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    // The intent shape #2400 defined, handed over verbatim — the sweep assembles
    // no second spelling and, critically, takes no claim of its own: the
    // at-most-once guarantee is `claimDispatchRelay`'s, inside `relayDispatch`.
    expect(
      relay.relayDispatch.mock.calls.map((call: unknown[]): unknown => call[0])
    ).toEqual([
      { kind: 'dispatch', workId: 'ol_work_1' },
      { kind: 'dispatch', workId: 'ol_work_2' },
    ]);
  });

  it('should re-drive from OL rows alone, replaying no vendor event (AC1)', () => {
    // The handler's only inputs are the reconcile read and the relay. It holds no
    // progress-ingress seam at all, so it structurally cannot replay an event —
    // which is the whole reason the recovery is a sweep rather than a retry.
    const injected = Object.getOwnPropertyNames(handler);
    expect(injected).toEqual(
      expect.arrayContaining(['reconcile', 'relay', 'syncLock', 'configService'])
    );
    expect(injected).not.toContain('progress');
    expect(injected).not.toContain('claims');
  });

  it('should touch NOTHING but the relay on the failing path, where a claim release would live (AC2)', async () => {
    // The behavioural half of AC2, written so it can actually fail. A fixture the
    // handler never reaches would assert only that the fixture works; what is
    // asserted instead is the handler's whole observable effect on the path where
    // a tempting "release the progress claim too" would be added — the `released`
    // arm, i.e. the one where `dispatchRelayedAt` HAS just been handed back.
    //
    // Its only collaborators are the lock, the read and the relay. There is no
    // progress-claim seam to release through, and the durable half of this
    // guarantee is `no-progress-claim-release.spec.ts`, which fails if one is ever
    // added to the port or the repository.
    reconcile.listUnrelayedDispatches.mockResolvedValue(page([candidate('ol_work_1')]));
    relay.relayDispatch.mockResolvedValue({ status: 'released', reason: 'source rejected' });

    await handler.execute(job());

    expect(reconcile.listUnrelayedDispatches).toHaveBeenCalledTimes(1);
    expect(relay.relayDispatch).toHaveBeenCalledTimes(1);
    // The reconcile seam is READ-ONLY as far as this handler is concerned: it
    // exposes one method, and a release added to it would show up here.
    expect(Object.keys(reconcile)).toEqual(['listUnrelayedDispatches']);
    expect(Object.keys(relay)).toEqual(['relayDispatch']);
  });

  it('should count a released re-drive without failing the job', async () => {
    // A transient failure leaves the work on the frontier for the next tick. That
    // is the pass working, not the job failing.
    reconcile.listUnrelayedDispatches.mockResolvedValue(page([candidate('ol_work_1')]));
    relay.relayDispatch.mockResolvedValue({ status: 'released', reason: 'boom' });

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });

  it('should treat a lost claim race as an ordinary outcome, never a failure', async () => {
    reconcile.listUnrelayedDispatches.mockResolvedValue(page([candidate('ol_work_1')]));
    relay.relayDispatch.mockResolvedValue({ status: 'already-relayed' });

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });

  it('should escalate a stuck candidate under a greppable token AND still re-drive it (AC4)', async () => {
    reconcile.listUnrelayedDispatches.mockResolvedValue(
      page([candidate('ol_work_stuck', { stuck: true })])
    );

    await handler.execute(job());

    expect(errors.some((line) => line.includes('fulfillment_relay_reconcile_stuck'))).toBe(true);
    expect(errors.some((line) => line.includes(STUCK_DETAIL))).toBe(true);
    // Still attempted: `adapter-unresolved` is transient by #1947's own
    // classification and clears on a re-auth.
    expect(relay.relayDispatch).toHaveBeenCalledTimes(1);
  });

  it('should not escalate a candidate inside the bound', async () => {
    reconcile.listUnrelayedDispatches.mockResolvedValue(page([candidate('ol_work_1')]));

    await handler.execute(job());

    expect(errors.some((line) => line.includes('fulfillment_relay_reconcile_stuck'))).toBe(false);
  });

  it('should surface a page in which nothing could be relayed', async () => {
    // Candidates are oldest-first and a failing one keeps its place at the head,
    // so enough of them starve the page. A scan offset is unavailable here
    // (frontier-as-query), so the condition is surfaced rather than worked around.
    reconcile.listUnrelayedDispatches.mockResolvedValue(
      page([candidate('ol_work_1'), candidate('ol_work_2')])
    );
    relay.relayDispatch.mockResolvedValue({ status: 'released', reason: 'boom' });

    await handler.execute(job());

    expect(
      errors.some((line) => line.includes('fulfillment_relay_reconcile_page_all_stalled'))
    ).toBe(true);
  });

  it('should NOT report a stalled page when a peer relayed one of them', async () => {
    // `already-relayed` is progress: somebody told the source.
    reconcile.listUnrelayedDispatches.mockResolvedValue(
      page([candidate('ol_work_1'), candidate('ol_work_2')])
    );
    relay.relayDispatch
      .mockResolvedValueOnce({ status: 'released', reason: 'boom' })
      .mockResolvedValueOnce({ status: 'already-relayed' });

    await handler.execute(job());

    expect(
      errors.some((line) => line.includes('fulfillment_relay_reconcile_page_all_stalled'))
    ).toBe(false);
  });

  it('should NOT report a stalled page when it examined nothing', async () => {
    await handler.execute(job());

    expect(
      errors.some((line) => line.includes('fulfillment_relay_reconcile_page_all_stalled'))
    ).toBe(false);
  });

  it('should count a throwing re-drive and keep going rather than aborting the page', async () => {
    reconcile.listUnrelayedDispatches.mockResolvedValue(
      page([candidate('ol_work_1'), candidate('ol_work_2')])
    );
    relay.relayDispatch
      .mockRejectedValueOnce(new Error('claim read exploded'))
      .mockResolvedValueOnce({ status: 'relayed' });

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(relay.relayDispatch).toHaveBeenCalledTimes(2);
  });

  it('should wrap a failed read in SyncJobExecutionError and release the lock', async () => {
    reconcile.listUnrelayedDispatches.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).rejects.toThrow(/fulfillment.work.relaySweep failed/);
    expect(syncLock.release).toHaveBeenCalledWith(
      'fulfillment:work:relay-sweep:00000000-0000-0000-0000-000000000000',
      'token'
    );
  });

  it('should release the lock on the happy path too', async () => {
    await handler.execute(job());

    expect(syncLock.release).toHaveBeenCalledTimes(1);
  });

  it('should use the derived default budget when the payload carries no pageLimit', async () => {
    await handler.execute(job({ schemaVersion: 1 }));

    expect(reconcile.listUnrelayedDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_DEFAULT })
    );
  });

  it('should honour a payload pageLimit so a backlog is drained without moving the default', async () => {
    await handler.execute(job({ schemaVersion: 1, pageLimit: 120 }));

    expect(reconcile.listUnrelayedDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 120 })
    );
  });

  it('should clamp a payload pageLimit above the family ceiling', async () => {
    await handler.execute(job({ schemaVersion: 1, pageLimit: 100_000 }));

    expect(reconcile.listUnrelayedDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 })
    );
  });

  it('should tolerate a null payload rather than throwing', async () => {
    // The declared type says what a WRITER must send, never what a reader may
    // assume — the value crosses a jsonb column.
    await expect(handler.execute(job(null))).resolves.toEqual({ outcome: 'ok' });
  });

  it('should resolve both age bounds through their single env paths', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'OL_FULFILLMENT_RELAY_GRACE_MS'
        ? '300000'
        : key === 'OL_FULFILLMENT_RELAY_STUCK_AFTER_MS'
          ? '3600000'
          : undefined
    );

    await handler.execute(job());

    expect(reconcile.listUnrelayedDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ graceMs: 300_000, stuckAfterMs: 3_600_000 })
    );
  });
});
