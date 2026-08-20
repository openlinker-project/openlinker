/**
 * Bounded Sweep unit tests (#2218 / #2219)
 *
 * @module apps/worker/src/sync/__tests__
 */

import {
  formatSweepCursor,
  parseSweepCursor,
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  runBoundedSweep,
  sweepCursorKey,
  sweepLockKey,
  SWEEP_BUDGET_DEFAULT,
  SWEEP_BUDGET_MAX,
} from '../bounded-sweep';
import type { SweepPage } from '../bounded-sweep.types';

const CYCLE = 'cycle-1';

function page(items: string[], overrides: Partial<SweepPage> = {}): SweepPage {
  return {
    items,
    consumed: overrides.consumed ?? items.length,
    exhausted: overrides.exhausted ?? false,
  };
}

describe('resolveSweepBudget', () => {
  it('should return the default when no page limit is supplied', () => {
    expect(resolveSweepBudget(undefined)).toBe(SWEEP_BUDGET_DEFAULT);
  });

  it('should floor a zero or negative page limit to 1 so a run is never unbounded', () => {
    expect(resolveSweepBudget(0)).toBe(1);
    expect(resolveSweepBudget(-50)).toBe(1);
  });

  it('should clamp a page limit above the ceiling', () => {
    expect(resolveSweepBudget(100_000)).toBe(SWEEP_BUDGET_MAX);
  });
});

describe('resolveSweepLockTtlMs', () => {
  it('should default when the env value is absent or unparseable', () => {
    expect(resolveSweepLockTtlMs(undefined)).toBe(300_000);
    expect(resolveSweepLockTtlMs('not-a-number')).toBe(300_000);
  });

  it('should clamp to the supported range', () => {
    expect(resolveSweepLockTtlMs('1000')).toBe(60_000);
    expect(resolveSweepLockTtlMs('99999999')).toBe(1_800_000);
  });
});

describe('sweep keys', () => {
  it('should scope the lock and cursor per connection and kind', () => {
    expect(sweepLockKey('product', 'conn-1')).toBe('master:product:sweep:conn-1');
    expect(sweepCursorKey('inventory', 'conn-1')).toBe(
      'master.inventory.sweep:connection:conn-1'
    );
  });
});

describe('parseSweepCursor', () => {
  it('should round-trip a formatted cursor', () => {
    const cursor = { cycleId: CYCLE, offset: 250 };
    expect(parseSweepCursor(formatSweepCursor(cursor))).toEqual(cursor);
  });

  it('should start a fresh cycle when the stored value is absent or empty', () => {
    expect(parseSweepCursor(null)).toBeNull();
    expect(parseSweepCursor('')).toBeNull();
  });

  it('should start a fresh cycle rather than throw when the stored value is malformed', () => {
    // A legacy scalar value, a non-numeric offset, and a negative offset must all
    // degrade to a fresh cycle — a bad cursor must never wedge a sweep.
    expect(parseSweepCursor('42')).toBeNull();
    expect(parseSweepCursor(`${CYCLE}:abc`)).toBeNull();
    expect(parseSweepCursor(`${CYCLE}:-1`)).toBeNull();
  });

  it('should preserve a cycle id containing the separator', () => {
    expect(parseSweepCursor('a:b:c:7')).toEqual({ cycleId: 'a:b:c', offset: 7 });
  });
});

describe('runBoundedSweep', () => {
  it('should mint a cycle id and enqueue the page when starting fresh', async () => {
    // Arrange
    const enqueue = jest.fn().mockResolvedValue(undefined);

    // Act
    const result = await runBoundedSweep({
      cursor: null,
      budget: 10,
      readPage: () => Promise.resolve(page(['a', 'b', 'c'])),
      enqueue,
      newCycleId: () => CYCLE,
    });

    // Assert
    expect(result.cycleId).toBe(CYCLE);
    expect(result.enqueued).toBe(3);
    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 3 });
    expect(enqueue).toHaveBeenCalledWith('a', CYCLE);
  });

  it('should resume from the stored offset and keep the same cycle id', async () => {
    // Arrange
    const readPage = jest.fn().mockResolvedValue(page(['d', 'e']));

    // Act
    const result = await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 3 },
      budget: 10,
      readPage,
      enqueue: jest.fn().mockResolvedValue(undefined),
      newCycleId: () => 'must-not-be-used',
    });

    // Assert
    expect(readPage).toHaveBeenCalledWith(3, 10);
    expect(result.cycleId).toBe(CYCLE);
    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 5 });
  });

  it('should clear the cursor when the source is exhausted', async () => {
    const result = await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 5 },
      budget: 10,
      readPage: () => Promise.resolve(page(['f'], { exhausted: true })),
      enqueue: jest.fn().mockResolvedValue(undefined),
      newCycleId: () => CYCLE,
    });

    expect(result.completed).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('should advance by consumed, not by item count, when the caller filtered the page', async () => {
    // The inventory sweep drops synthetic `product:` ids after reading them; the
    // cursor must count what was READ or the sweep re-reads the filtered rows.
    const result = await runBoundedSweep({
      cursor: null,
      budget: 10,
      readPage: () => Promise.resolve(page(['keep-1', 'keep-2'], { consumed: 10 })),
      enqueue: jest.fn().mockResolvedValue(undefined),
      newCycleId: () => CYCLE,
    });

    expect(result.enqueued).toBe(2);
    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 10 });
  });

  it('should NOT advance the cursor when any enqueue fails', async () => {
    // Cursor safety (docs/code-review-guide.md § Security & Safety): advancing
    // past a failed id would skip it silently until the next full cycle.
    const enqueue = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);

    const result = await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 100 },
      budget: 10,
      readPage: () => Promise.resolve(page(['a', 'b', 'c'])),
      enqueue,
      newCycleId: () => CYCLE,
    });

    expect(result.failed).toBe(1);
    expect(result.enqueued).toBe(2);
    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 100 });
    expect(result.completed).toBe(false);
  });

  it('should not complete the cycle when the final page had a failure', async () => {
    const result = await runBoundedSweep({
      cursor: null,
      budget: 10,
      readPage: () => Promise.resolve(page(['a'], { exhausted: true })),
      enqueue: jest.fn().mockRejectedValue(new Error('down')),
      newCycleId: () => CYCLE,
    });

    expect(result.completed).toBe(false);
    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 0 });
  });

  it('should re-enqueue under the same cycle id after a crash between enqueue and cursor write', async () => {
    // The property that makes the design crash-safe: the retry produces the same
    // child idempotency keys, so the duplicates dedupe instead of doubling work.
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const readPage = (): Promise<SweepPage> => Promise.resolve(page(['a', 'b']));

    await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 0 },
      budget: 10,
      readPage,
      enqueue,
      newCycleId: () => 'fresh-cycle',
    });
    // Simulates the next tick after a crash: the cursor was never written, so the
    // same stored value is read again.
    await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 0 },
      budget: 10,
      readPage,
      enqueue,
      newCycleId: () => 'fresh-cycle',
    });

    const cycleArgs = (enqueue.mock.calls as unknown[][]).map((call) => String(call[1]));
    expect(cycleArgs).toEqual([CYCLE, CYCLE, CYCLE, CYCLE]);
  });

  it('should advance past an empty non-exhausted page so the sweep cannot stall', async () => {
    // Every item on the page was filtered out by the caller. The cursor advances
    // by rows READ, or the sweep re-reads the same offset forever.
    const result = await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 20 },
      budget: 10,
      readPage: () => Promise.resolve(page([], { consumed: 10 })),
      enqueue: jest.fn(),
      newCycleId: () => CYCLE,
    });

    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 30 });
    expect(result.completed).toBe(false);
  });

  it('should hold the cursor rather than skip a row when a caller reports nothing consumed', async () => {
    // `consumed: 0` with `exhausted: false` is a caller-contract violation
    // neither handler can produce. Holding stalls visibly; nudging past it would
    // skip an unread source row silently.
    const result = await runBoundedSweep({
      cursor: { cycleId: CYCLE, offset: 20 },
      budget: 10,
      readPage: () => Promise.resolve(page([], { consumed: 0 })),
      enqueue: jest.fn(),
      newCycleId: () => CYCLE,
    });

    expect(result.nextCursor).toEqual({ cycleId: CYCLE, offset: 20 });
  });

  it('should complete on an empty exhausted page', async () => {
    const result = await runBoundedSweep({
      cursor: null,
      budget: 10,
      readPage: () => Promise.resolve(page([], { consumed: 0, exhausted: true })),
      enqueue: jest.fn(),
      newCycleId: () => CYCLE,
    });

    expect(result.completed).toBe(true);
    expect(result.nextCursor).toBeNull();
  });
});
