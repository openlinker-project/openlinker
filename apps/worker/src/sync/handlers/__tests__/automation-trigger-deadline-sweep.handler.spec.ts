/**
 * AutomationTriggerDeadlineSweepHandler specs (#2360)
 *
 * The `occurredAt` test is the important one: it pins the CROSSING-not-deadline
 * rule, whose inversion would clear #2359's retroactivity floor unconditionally
 * and buy a label for every order already inside a new rule's window.
 */
import { AutomationTriggerDeadlineSweepHandler } from '../automation-trigger-deadline-sweep.handler';

const NOW_MS = new Date('2026-09-10T12:00:00.000Z').getTime();

function makeJob() {
  return { id: 'job-1', jobType: 'automation.trigger.deadlineSweep', connectionId: 'conn-1', payload: {} } as never;
}

describe('AutomationTriggerDeadlineSweepHandler', () => {
  let orderRecords: { findDispatchDeadlineCandidates: jest.Mock };
  let rules: { listRulesByTrigger: jest.Mock };
  let emission: { emit: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let locks: { acquire: jest.Mock; release: jest.Mock };
  let handler: AutomationTriggerDeadlineSweepHandler;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW_MS);
    orderRecords = { findDispatchDeadlineCandidates: jest.fn().mockResolvedValue([]) };
    rules = { listRulesByTrigger: jest.fn().mockResolvedValue([{ triggerConfig: { hoursBefore: 24 } }]) };
    emission = { emit: jest.fn().mockResolvedValue({ firedRuleIds: [], alreadyFiredRuleIds: [], evaluatedRuleCount: 1 }) };
    cursors = { getCursor: jest.fn().mockResolvedValue(null), advanceCursor: jest.fn().mockResolvedValue(undefined) };
    locks = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(true) };
    handler = new AutomationTriggerDeadlineSweepHandler(
      orderRecords as never, rules as never, emission as never, cursors as never, locks as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  function candidate(dispatchByAt: Date) {
    return { internalOrderId: 'ol_order_1', dispatchByAt, sourceConnectionId: 'conn-1' };
  }

  it('should pass occurredAt as the CROSSING, never the deadline', async () => {
    // Deadline 10h out, rule window 24h → the crossing was 14h AGO.
    const deadline = new Date(NOW_MS + 10 * 3600_000);
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([candidate(deadline)]);

    await handler.execute(makeJob());

    const facts = (emission.emit.mock.calls[0] as [{ facts: { occurredAt: Date } }])[0].facts;
    expect(facts.occurredAt.getTime()).toBe(deadline.getTime() - 24 * 3600_000);
    // The inversion this guards against: occurredAt must NOT be the deadline,
    // which is in the future and would clear the retroactivity floor always.
    expect(facts.occurredAt.getTime()).not.toBe(deadline.getTime());
    expect(facts.occurredAt.getTime()).toBeLessThan(NOW_MS);
  });

  it('should not emit for a candidate whose window has not been entered yet', async () => {
    // Deadline 100h out, window 24h → the crossing is 76h in the future.
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 100 * 3600_000)),
    ]);
    await handler.execute(makeJob());
    expect(emission.emit).not.toHaveBeenCalled();
  });

  it('should skip entirely and clear the cursor when no armed rule has a threshold', async () => {
    rules.listRulesByTrigger.mockResolvedValue([]);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).not.toHaveBeenCalled();
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '');
  });

  it('should serialise on a per-connection lock and release it', async () => {
    await handler.execute(makeJob());
    expect(locks.acquire).toHaveBeenCalledWith('automation:deadline-sweep:conn-1', expect.any(Number));
    expect(locks.release).toHaveBeenCalledWith('automation:deadline-sweep:conn-1', 'token');
  });

  it('should no-op when the lock is held by a concurrent run', async () => {
    locks.acquire.mockResolvedValue(null);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).not.toHaveBeenCalled();
  });

  it('should clear the cursor when the page is short (cycle complete)', async () => {
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([
      candidate(new Date(NOW_MS + 10 * 3600_000)),
    ]);
    await handler.execute(makeJob());
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '');
  });

  it('should advance the cursor by rows READ, not by rows that fired', async () => {
    // A pair that lost its claim still consumed a row; paging by outcome would
    // re-read it forever.
    const full = Array.from({ length: 200 }, () => candidate(new Date(NOW_MS + 10 * 3600_000)));
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue(full);
    emission.emit.mockResolvedValue({ firedRuleIds: [], alreadyFiredRuleIds: ['a'], evaluatedRuleCount: 1 });
    await handler.execute(makeJob());
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-1', expect.any(String), '200');
  });

  it('should start a fresh cycle on a malformed cursor rather than wedging', async () => {
    cursors.getCursor.mockResolvedValue('not-a-number');
    orderRecords.findDispatchDeadlineCandidates.mockResolvedValue([]);
    await handler.execute(makeJob());
    expect(orderRecords.findDispatchDeadlineCandidates).toHaveBeenCalledWith(
      'conn-1', expect.objectContaining({ offset: 0 }),
    );
  });
});
