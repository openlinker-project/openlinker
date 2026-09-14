/**
 * FulfillmentDispatchTimeoutService — unit spec (#2712)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import { FulfillmentDispatchTimeoutService } from '../fulfillment-dispatch-timeout.service';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const TIMEOUT_MS = 2 * 60 * 60 * 1000;

const candidate = (overrides: Partial<Record<string, unknown>> = {}) => ({
  workId: 'ol_fulfillmentwork_1',
  orderId: 'ol_order_1',
  assignedConnectionId: 'conn-1',
  assignmentAttempt: 3,
  idleSince: new Date('2026-09-08T06:00:00.000Z'),
  ...overrides,
});

const acceptedWork = (): FulfillmentWork =>
  ({ id: 'w1', status: 'open', requestStatus: 'accepted' }) as unknown as FulfillmentWork;

describe('FulfillmentDispatchTimeoutService (#2712)', () => {
  let repository: jest.Mocked<
    Pick<
      FulfillmentWorkRepositoryPort,
      'listTimedOutDispatches' | 'recordRejection' | 'findByOrderId'
    >
  >;
  let service: FulfillmentDispatchTimeoutService;

  beforeEach(() => {
    repository = {
      listTimedOutDispatches: jest.fn().mockResolvedValue([]),
      recordRejection: jest.fn().mockResolvedValue(true),
      findByOrderId: jest.fn().mockResolvedValue([]),
    };
    service = new FulfillmentDispatchTimeoutService(
      repository as unknown as FulfillmentWorkRepositoryPort
    );
  });

  const reap = () =>
    service.reapTimedOutDispatches({ limit: 200, timeoutMs: TIMEOUT_MS, now: NOW });

  it('should read the frontier at now minus the resolved timeout', async () => {
    await reap();

    expect(repository.listTimedOutDispatches).toHaveBeenCalledWith({
      idleBefore: new Date(NOW.getTime() - TIMEOUT_MS),
      limit: 200,
    });
  });

  it('should reap through recordRejection, never a new writer of requestStatus', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([candidate()] as never);

    const result = await reap();

    expect(result.reaped).toBe(1);
    expect(repository.recordRejection).toHaveBeenCalledTimes(1);
  });

  it('should record the reap as NON-blocking, under the namespaced reason', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([candidate()] as never);

    await reap();

    expect(repository.recordRejection).toHaveBeenCalledWith(
      expect.objectContaining({
        blocking: false,
        reason: 'openlinker:dispatch-timeout',
        rejectedAt: NOW,
      })
    );
  });

  it('should PIN the attempt it read, because the sweep is a delayed actor', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([
      candidate({ assignmentAttempt: 7 }),
    ] as never);

    await reap();

    expect(repository.recordRejection).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentAttempt: 7, expectedAssignmentAttempt: 7 })
    );
  });

  it('should stamp a detail built from the SAME timeout the cutoff used (AC3)', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([candidate()] as never);

    await reap();

    const [input] = repository.recordRejection.mock.calls[0] as [{ detail: string | null }];
    expect(input.detail).toContain('2 hours');
  });

  it('should count a lost race as RACED and emit no attention intent', async () => {
    // If the holder accepted in that window, writing A3-X would be a false
    // claim about work somebody just took.
    repository.listTimedOutDispatches.mockResolvedValue([candidate()] as never);
    repository.recordRejection.mockResolvedValue(false);

    const result = await reap();

    expect(result).toMatchObject({ examined: 1, reaped: 0, raced: 1, failed: 0 });
    expect(result.attentionIntents).toEqual([]);
    expect(repository.findByOrderId).not.toHaveBeenCalled();
  });

  it('should SKIP a submitted row with no holder rather than name nobody', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([
      candidate({ assignedConnectionId: null }),
    ] as never);

    const result = await reap();

    expect(result.skippedUnassigned).toBe(1);
    expect(repository.recordRejection).not.toHaveBeenCalled();
  });

  it('should count a per-candidate failure and CONTINUE the page', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([
      candidate({ workId: 'w1' }),
      candidate({ workId: 'w2', orderId: 'ol_order_2' }),
    ] as never);
    repository.recordRejection
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    const result = await reap();

    expect(result).toMatchObject({ examined: 2, reaped: 1, failed: 1 });
  });

  it('should emit one attention intent per REAPED order, deduplicated', async () => {
    repository.listTimedOutDispatches.mockResolvedValue([
      candidate({ workId: 'w1', orderId: 'ol_order_1' }),
      candidate({ workId: 'w2', orderId: 'ol_order_1' }),
    ] as never);
    repository.findByOrderId.mockResolvedValue([acceptedWork()]);

    const result = await reap();

    // Two works, ONE order — the verdict is per order, so one intent.
    expect(result.attentionIntents).toHaveLength(1);
    expect(repository.findByOrderId).toHaveBeenCalledTimes(1);
  });

  it('should omit an intent rather than emit a CLEAR when the recompute read fails', async () => {
    // Absence leaves the stored entry untouched; a transient failure must never
    // erase a true reason (#2100).
    repository.listTimedOutDispatches.mockResolvedValue([candidate()] as never);
    repository.findByOrderId.mockRejectedValue(new Error('db down'));

    const result = await reap();

    expect(result.reaped).toBe(1);
    expect(result.attentionIntents).toEqual([]);
  });

  it('should report the timeout it applied on the result', async () => {
    const result = await reap();
    expect(result.timeoutMs).toBe(TIMEOUT_MS);
  });

  it('should propagate a frontier-read failure rather than report a healthy empty run', async () => {
    repository.listTimedOutDispatches.mockRejectedValue(new Error('db down'));
    await expect(reap()).rejects.toThrow('db down');
  });
});

describe('FulfillmentDispatchTimeoutService.recomputeAcceptanceAttention (#2712)', () => {
  it('should answer from ALL the order’s works through the one shared derivation', async () => {
    const repository = {
      listTimedOutDispatches: jest.fn(),
      recordRejection: jest.fn(),
      findByOrderId: jest.fn().mockResolvedValue([
        { id: 'w1', status: 'open', requestStatus: 'accepted' },
        { id: 'w2', status: 'open', requestStatus: 'rejected' },
      ]),
    };
    const service = new FulfillmentDispatchTimeoutService(
      repository as unknown as FulfillmentWorkRepositoryPort
    );

    await expect(service.recomputeAcceptanceAttention('ol_order_1')).resolves.toMatchObject({
      kind: 'blocked',
      reason: 'fulfillment-unaccepted',
    });
    expect(repository.findByOrderId).toHaveBeenCalledWith('ol_order_1');
  });

  it('should THROW on an infrastructure fault rather than report a clear', async () => {
    const repository = {
      listTimedOutDispatches: jest.fn(),
      recordRejection: jest.fn(),
      findByOrderId: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const service = new FulfillmentDispatchTimeoutService(
      repository as unknown as FulfillmentWorkRepositoryPort
    );

    await expect(service.recomputeAcceptanceAttention('ol_order_1')).rejects.toThrow('db down');
  });
});
