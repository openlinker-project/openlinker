/**
 * Inventory Provenance Backfill Handler - Unit Tests (#2317)
 *
 * Four properties this file exists to pin, because each is a silent failure if
 * it regresses:
 *
 * 1. The latch is read BEFORE the lock and before any table access, so a
 *    drained deployment pays one cursor read per tick forever.
 * 2. A failed page persists NOTHING - not the count, not the latch - which is
 *    this design's structural answer to "the cursor must not advance past
 *    unfinished work" (there is no cursor to advance).
 * 3. The completion stamp is written only on a completed run, and only AFTER
 *    the remaining-count stamp.
 * 4. The two persisted cursor keys are hard-coded here, independently of the
 *    builders, because #2325 reads them.
 *
 * @module apps/worker/src/sync/handlers
 */
import { ConfigService } from '@nestjs/config';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import type { IInventoryProvenanceBackfillService } from '@openlinker/core/inventory';
import { InventoryProvenanceBackfillHandler } from './inventory-provenance-backfill.handler';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const COMPLETED_AT_KEY = `master.inventory-provenance.completedAt:connection:${SYSTEM_ID}`;
const REMAINING_KEY = `master.inventory-provenance.remainingNull:connection:${SYSTEM_ID}`;
const LOCK_KEY = `master:inventory-provenance:sweep:${SYSTEM_ID}`;

describe('InventoryProvenanceBackfillHandler (#2317)', () => {
  let handler: InventoryProvenanceBackfillHandler;
  let backfill: jest.Mocked<IInventoryProvenanceBackfillService>;
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };

  function makeJob(payload: unknown = { schemaVersion: 1 }): SyncJob {
    return {
      id: 'job-1',
      jobType: 'inventory.provenance.backfill',
      connectionId: SYSTEM_ID,
      payload,
    } as unknown as SyncJob;
  }

  /** The cursor KEYS advanced so far, in call order. */
  function advancedCursorKeys(): string[] {
    return cursors.advanceCursor.mock.calls.map(
      (call) => (call as [string, string, string])[1]
    );
  }

  beforeEach(() => {
    backfill = { runPage: jest.fn() } as unknown as jest.Mocked<IInventoryProvenanceBackfillService>;
    cursors = { getCursor: jest.fn().mockResolvedValue(null), advanceCursor: jest.fn() };
    syncLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn() };

    handler = new InventoryProvenanceBackfillHandler(
      backfill,
      cursors as never,
      syncLock as never,
      new ConfigService({})
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('the completion latch', () => {
    it('short-circuits without taking the lock or touching the table once complete', async () => {
      cursors.getCursor.mockResolvedValue('2026-08-24T09:00:00.000Z');

      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });

      // The whole steady-state cost of a tick after the drain finishes. Taking
      // the lock first would serialise every replica's no-op tick against
      // Redis forever.
      expect(syncLock.acquire).not.toHaveBeenCalled();
      expect(backfill.runPage).not.toHaveBeenCalled();
      expect(cursors.getCursor).toHaveBeenCalledWith(SYSTEM_ID, COMPLETED_AT_KEY);
    });

    it('runs when the latch cursor is absent', async () => {
      cursors.getCursor.mockResolvedValue(null);
      backfill.runPage.mockResolvedValue({ stamped: 5, remainingNull: 10, completed: false });

      await handler.execute(makeJob());

      expect(backfill.runPage).toHaveBeenCalled();
    });

    it('runs when the latch cursor is an empty string', async () => {
      // The sweep family clears a cursor to '' rather than deleting it, so an
      // empty value must not read as "completed" - that would latch the pass
      // off before it ever ran.
      cursors.getCursor.mockResolvedValue('');
      backfill.runPage.mockResolvedValue({ stamped: 1, remainingNull: 1, completed: false });

      await handler.execute(makeJob());

      expect(backfill.runPage).toHaveBeenCalled();
    });
  });

  describe('the per-run lock', () => {
    it('skips without running a page when the lock is held', async () => {
      syncLock.acquire.mockResolvedValue(null);

      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });

      expect(backfill.runPage).not.toHaveBeenCalled();
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
      expect(syncLock.release).not.toHaveBeenCalled();
    });

    it('acquires its own namespace, not another sweep kind', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 0, remainingNull: 0, completed: true });

      await handler.execute(makeJob());

      expect(syncLock.acquire).toHaveBeenCalledWith(LOCK_KEY, expect.any(Number));
    });

    it('releases the lock on the success path', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 3, remainingNull: 3, completed: false });

      await handler.execute(makeJob());

      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });

    it('swallows a release failure rather than failing a page that succeeded', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 3, remainingNull: 3, completed: false });
      syncLock.release.mockRejectedValue(new Error('redis down'));

      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
    });
  });

  describe('a mid-drain page', () => {
    it('stamps the remaining count and nothing else', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 500, remainingNull: 1_200, completed: false });

      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });

      expect(cursors.advanceCursor).toHaveBeenCalledTimes(1);
      expect(cursors.advanceCursor).toHaveBeenCalledWith(SYSTEM_ID, REMAINING_KEY, '1200');
    });

    it('never writes a sweep-offset cursor', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 500, remainingNull: 1_200, completed: false });

      await handler.execute(makeJob());

      // The predicate IS the cursor. An offset advancing over a self-consuming
      // set steps over rows and leaves them unstamped - see the handler header.
      const keys = advancedCursorKeys();
      expect(keys.some((key) => key.includes('.sweep:'))).toBe(false);
    });
  });

  describe('the completing page', () => {
    it('stamps the remaining count first, then the completion timestamp', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 12, remainingNull: 0, completed: true });

      await handler.execute(makeJob());

      const keys = advancedCursorKeys();
      // Order is load-bearing: a crash between the two must leave the latch
      // UNSET (one extra no-op page) rather than latch the pass off while the
      // readiness number #2325 reads was never written.
      expect(keys).toEqual([REMAINING_KEY, COMPLETED_AT_KEY]);
      expect(cursors.advanceCursor).toHaveBeenNthCalledWith(1, SYSTEM_ID, REMAINING_KEY, '0');
      expect(cursors.advanceCursor).toHaveBeenNthCalledWith(
        2,
        SYSTEM_ID,
        COMPLETED_AT_KEY,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    it('still reports ok when a stamp write fails', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 12, remainingNull: 0, completed: true });
      cursors.advanceCursor.mockRejectedValue(new Error('cursor store unavailable'));

      // The page's own write already committed. Failing here would retry a job
      // whose work succeeded; both stamps self-heal on the next tick, because
      // the count is retaken every run and the latch is retried while unset.
      await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
      expect(syncLock.release).toHaveBeenCalled();
    });
  });

  describe('a failed page', () => {
    it('throws, persists nothing, and releases the lock', async () => {
      backfill.runPage.mockRejectedValue(new Error('deadlock detected'));

      await expect(handler.execute(makeJob())).rejects.toBeInstanceOf(SyncJobExecutionError);

      // AC: nothing advances past unfinished work. Structurally satisfied -
      // there is no state to hold, because none was written.
      expect(cursors.advanceCursor).not.toHaveBeenCalled();
      expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
    });
  });

  describe('the payload envelope', () => {
    it('uses the row-derived default of 500 when pageLimit is absent', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 0, remainingNull: 0, completed: true });

      await handler.execute(makeJob({ schemaVersion: 1 }));

      // Deliberately NOT resolveSweepBudget's own default of 100, which is
      // derived from a child job doing a full per-product platform sync. One
      // unit here is a row in a local UPDATE.
      expect(backfill.runPage).toHaveBeenCalledWith(500);
    });

    it('honours a smaller payload-supplied page', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 5, remainingNull: 0, completed: true });

      await handler.execute(makeJob({ schemaVersion: 1, pageLimit: 5 }));

      expect(backfill.runPage).toHaveBeenCalledWith(5);
    });

    it('clamps an oversized page down to the family ceiling', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 0, remainingNull: 0, completed: true });

      await handler.execute(makeJob({ schemaVersion: 1, pageLimit: 100_000 }));

      // A payload can never widen the lock footprint past what the design
      // budgeted for.
      expect(backfill.runPage).toHaveBeenCalledWith(500);
    });

    it('floors a fractional page and never runs a zero-row one', async () => {
      backfill.runPage.mockResolvedValue({ stamped: 0, remainingNull: 0, completed: true });

      await handler.execute(makeJob({ schemaVersion: 1, pageLimit: 0 }));

      // A zero page would stall the drain silently, forever.
      expect(backfill.runPage).toHaveBeenCalledWith(1);
    });

    it('throws on a payload with the wrong schemaVersion', async () => {
      // The scheduler is the only producer, so a malformed envelope is a defect
      // and must be loud (the fx-stamp sweep's posture, not the reconcile
      // handler's silent default).
      await expect(handler.execute(makeJob({ schemaVersion: 2 }))).rejects.toBeInstanceOf(
        SyncJobExecutionError
      );
      expect(backfill.runPage).not.toHaveBeenCalled();
    });

    it('throws on a non-object payload', async () => {
      await expect(handler.execute(makeJob(null))).rejects.toBeInstanceOf(SyncJobExecutionError);
      await expect(handler.execute(makeJob('nope'))).rejects.toBeInstanceOf(SyncJobExecutionError);
    });

    it('validates the envelope only AFTER the latch, so a drained pass never throws', async () => {
      cursors.getCursor.mockResolvedValue('2026-08-24T09:00:00.000Z');

      await expect(handler.execute(makeJob({ schemaVersion: 9 }))).resolves.toEqual({
        outcome: 'ok',
      });
    });
  });
});
