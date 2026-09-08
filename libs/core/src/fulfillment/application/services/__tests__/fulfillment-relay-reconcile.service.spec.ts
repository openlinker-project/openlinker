/**
 * Fulfillment Relay Reconcile Service — spec (#2728)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type {
  FulfillmentWorkRepositoryPort,
  ListUnrelayedShippedDispatchesInput,
  UnrelayedShippedDispatch,
} from '../../../domain/ports/fulfillment-work-repository.port';
import { FulfillmentRelayReconcileService } from '../fulfillment-relay-reconcile.service';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const GRACE_MS = 15 * 60 * 1000;
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

function shippedAgo(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function buildRepository(rows: UnrelayedShippedDispatch[]): {
  repository: FulfillmentWorkRepositoryPort;
  calls: ListUnrelayedShippedDispatchesInput[];
} {
  const calls: ListUnrelayedShippedDispatchesInput[] = [];
  const repository = {
    listUnrelayedShippedDispatches: jest
      .fn()
      .mockImplementation((input: ListUnrelayedShippedDispatchesInput) => {
        calls.push(input);
        return Promise.resolve(rows);
      }),
  } as unknown as FulfillmentWorkRepositoryPort;
  return { repository, calls };
}

describe('FulfillmentRelayReconcileService', () => {
  it('should derive the frontier cutoff by subtracting the grace window from now', async () => {
    const { repository, calls } = buildRepository([]);
    const service = new FulfillmentRelayReconcileService(repository);

    await service.listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: NOW,
    });

    expect(calls).toEqual([
      { shippedBefore: new Date(NOW.getTime() - GRACE_MS), limit: 25 },
    ]);
  });

  it('should report each row as a dispatch INTENT rather than a bare id', async () => {
    // The shape #2400 already defined, so the caller hands it straight to
    // `relayDispatch` instead of assembling a second spelling of one fact.
    const { repository } = buildRepository([
      { workId: 'ol_work_1', orderId: 'ol_order_1', shippedAt: shippedAgo(GRACE_MS + 1) },
    ]);
    const service = new FulfillmentRelayReconcileService(repository);

    const result = await service.listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: NOW,
    });

    expect(result.candidates).toEqual([
      {
        intent: { kind: 'dispatch', workId: 'ol_work_1' },
        orderId: 'ol_order_1',
        shippedAt: shippedAgo(GRACE_MS + 1),
        stuck: false,
      },
    ]);
  });

  it('should classify a candidate past the escalation age as stuck and STILL return it', async () => {
    // AC4 escalates; it never withholds. `adapter-unresolved` is transient by
    // #1947's classification and clears on a re-auth, so withholding the attempt
    // would turn a recoverable condition into a permanent one.
    const { repository } = buildRepository([
      { workId: 'ol_work_old', orderId: 'ol_order_1', shippedAt: shippedAgo(STUCK_AFTER_MS + 1) },
      { workId: 'ol_work_new', orderId: 'ol_order_2', shippedAt: shippedAgo(GRACE_MS + 1) },
    ]);
    const service = new FulfillmentRelayReconcileService(repository);

    const result = await service.listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: NOW,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.stuck).toBe(true);
    expect(result.candidates[1]?.stuck).toBe(false);
    expect(result.stuckCount).toBe(1);
  });

  it('should echo the SAME resolved bound it classified with, and its sentence', async () => {
    // #2229: what an operator reads and what classified the work cannot differ.
    const { repository } = buildRepository([]);
    const service = new FulfillmentRelayReconcileService(repository);

    const result = await service.listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: 7 * 86_400_000,
      now: NOW,
    });

    expect(result.stuckAfterMs).toBe(7 * 86_400_000);
    expect(result.stuckDetail).toContain('7 days');
  });

  it('should report an empty page without failing when nothing is unrelayed', async () => {
    const { repository } = buildRepository([]);
    const service = new FulfillmentRelayReconcileService(repository);

    const result = await service.listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: NOW,
    });

    expect(result.candidates).toEqual([]);
    expect(result.stuckCount).toBe(0);
  });

  it('should propagate a repository failure rather than reporting an empty page', async () => {
    // An empty page is a positive claim that nothing is unrelayed. A failed read
    // must never be reported as one, or a broken database reads as a healthy
    // install with nothing to do.
    const repository = {
      listUnrelayedShippedDispatches: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as FulfillmentWorkRepositoryPort;
    const service = new FulfillmentRelayReconcileService(repository);

    await expect(
      service.listUnrelayedDispatches({
        limit: 25,
        graceMs: GRACE_MS,
        stuckAfterMs: STUCK_AFTER_MS,
        now: NOW,
      })
    ).rejects.toThrow('db down');
  });
});
