/**
 * Reservation shortfall handler (#2349)
 *
 * The properties under test are the ones a budgeted, resumable, locked pass
 * lives or dies by: the lock is honoured, cursors are written ONLY after a
 * successful run, and a malformed cursor starts a fresh cycle rather than
 * wedging the pass.
 *
 * @module apps/worker/src/sync/handlers
 */
import { ConfigService } from '@nestjs/config';
import type { SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IReservationShortfallService } from '@openlinker/core/inventory';
import {
  ReservationShortfallHandler,
  reservationShortfallLockKey,
} from './reservation-shortfall.handler';

const SCOPE = '00000000-0000-0000-0000-000000000000';

const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
  ({
    id: 'job-1',
    jobType: 'inventory.reservations.shortfall',
    connectionId: SCOPE,
    payload,
  }) as unknown as SyncJob;

const emptyResult = {
  positionsExamined: 0,
  episodesOpened: 0,
  episodesStillOpen: 0,
  episodesExamined: 0,
  episodesClosed: 0,
  unattributed: 0,
  failed: 0,
  nextDetectOffset: 0,
  nextCloseOffset: 0,
};

describe('ReservationShortfallHandler', () => {
  let shortfalls: jest.Mocked<IReservationShortfallService>;
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let handler: ReservationShortfallHandler;

  beforeEach(() => {
    shortfalls = {
      detectShortfalls: jest.fn().mockResolvedValue(emptyResult),
      listOpenForOrder: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IReservationShortfallService>;
    syncLock = {
      acquire: jest.fn().mockResolvedValue('token'),
      release: jest.fn().mockResolvedValue(undefined),
    };
    cursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursor: jest.fn().mockResolvedValue(undefined),
    };

    handler = new ReservationShortfallHandler(
      shortfalls,
      syncLock as never,
      cursors as never,
      new ConfigService()
    );
  });

  it('should skip without running when the lock is already held', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(shortfalls.detectShortfalls).not.toHaveBeenCalled();
    expect(cursors.advanceCursor).not.toHaveBeenCalled();
  });

  it('should name its own lock rather than borrowing the master sweep namespace', () => {
    // `sweepLockKey` renders `master:{kind}:sweep:{id}` and would name a master
    // this pass does not have.
    expect(reservationShortfallLockKey(SCOPE)).toBe(
      `inventory:reservations:shortfall:${SCOPE}`
    );
  });

  it('should resume from the persisted offsets', async () => {
    cursors.getCursor.mockImplementation((_scope: string, key: string) =>
      Promise.resolve(key.endsWith('detectOffset') ? '40' : '7')
    );

    await handler.execute(job());

    expect(shortfalls.detectShortfalls).toHaveBeenCalledWith(
      expect.objectContaining({ detectOffset: 40, closeOffset: 7 })
    );
  });

  it('should start a fresh cycle when a cursor is malformed rather than wedging', async () => {
    cursors.getCursor.mockResolvedValue('not-a-number');

    await handler.execute(job());

    expect(shortfalls.detectShortfalls).toHaveBeenCalledWith(
      expect.objectContaining({ detectOffset: 0, closeOffset: 0 })
    );
  });

  it('should persist both offsets after a successful run', async () => {
    shortfalls.detectShortfalls.mockResolvedValue({
      ...emptyResult,
      nextDetectOffset: 200,
      nextCloseOffset: 50,
    });

    await handler.execute(job());

    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      SCOPE,
      'inventory.reservationShortfall.detectOffset',
      '200'
    );
    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      SCOPE,
      'inventory.reservationShortfall.closeOffset',
      '50'
    );
  });

  it('should leave both cursors untouched when the run fails, so the page is re-read', async () => {
    shortfalls.detectShortfalls.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job())).rejects.toBeInstanceOf(SyncJobExecutionError);

    expect(cursors.advanceCursor).not.toHaveBeenCalled();
    expect(syncLock.release).toHaveBeenCalled();
  });

  it('should release the lock even when the run throws', async () => {
    shortfalls.detectShortfalls.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job())).rejects.toBeInstanceOf(SyncJobExecutionError);

    expect(syncLock.release).toHaveBeenCalledWith(
      reservationShortfallLockKey(SCOPE),
      'token'
    );
  });

  it('should tolerate an absent payload', async () => {
    await expect(handler.execute(job(null))).resolves.toEqual({ outcome: 'ok' });
  });
});
