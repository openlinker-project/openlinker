/**
 * Reservation Consume Handler — Unit Tests (#2347)
 *
 * The handler owns no business rule (the consume-then-claim ordering lives in
 * `ShipmentReservationConsumeService`), so what this file pins is the
 * orchestration contract that would otherwise fail silently:
 *
 * 1. The per-run lock is taken under this pass's OWN key — not `sweepLockKey`,
 *    which renders `master:{kind}:sweep:{id}` and would name a master that does
 *    not exist here.
 * 2. A lock already held is a clean skip, never an error.
 * 3. The lock is released on every path, including the throwing one.
 * 4. Nothing is persisted on failure — there is no cursor — so a failed run
 *    leaves every candidate exactly where it was.
 *
 * @module apps/worker/src/sync/handlers
 */
import { ConfigService } from '@nestjs/config';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import type { IShipmentReservationConsumeService } from '@openlinker/core/shipping';
import {
  ReservationConsumeHandler,
  RESERVATION_CONSUME_PAGE_LIMIT_DEFAULT,
  reservationConsumeLockKey,
} from './reservation-consume.handler';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const LOCK_KEY = `inventory:reservations:consume:${SYSTEM_ID}`;

describe('ReservationConsumeHandler (#2347)', () => {
  let handler: ReservationConsumeHandler;
  let consume: jest.Mocked<IShipmentReservationConsumeService>;
  let syncLock: { acquire: jest.Mock; release: jest.Mock };

  function makeJob(payload: unknown = { schemaVersion: 1 }): SyncJob {
    return {
      id: 'job-1',
      jobType: 'inventory.reservations.consume',
      connectionId: SYSTEM_ID,
      payload,
    } as unknown as SyncJob;
  }

  beforeEach(() => {
    consume = {
      consumeDueShipments: jest.fn().mockResolvedValue({
        examined: 0,
        consumed: 0,
        reservationsConsumed: 0,
        alreadyTerminal: 0,
        skipped: 0,
        failed: 0,
      }),
    } as unknown as jest.Mocked<IShipmentReservationConsumeService>;
    syncLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn() };

    handler = new ReservationConsumeHandler(consume, syncLock as never, new ConfigService({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should take its own lock namespace, never the master sweep key', () => {
    // `sweepLockKey` renders `master:{kind}:sweep:{id}`; this pass has no master,
    // so borrowing that key would be a false name for the thing being locked.
    expect(reservationConsumeLockKey(SYSTEM_ID)).toBe(LOCK_KEY);
    expect(reservationConsumeLockKey(SYSTEM_ID)).not.toContain('master');
  });

  it('should run the pass under the lock with the default budget', async () => {
    await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });

    expect(syncLock.acquire).toHaveBeenCalledWith(LOCK_KEY, expect.any(Number));
    expect(consume.consumeDueShipments).toHaveBeenCalledWith({
      limit: RESERVATION_CONSUME_PAGE_LIMIT_DEFAULT,
    });
    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('should honour a payload pageLimit', async () => {
    await handler.execute(makeJob({ schemaVersion: 1, pageLimit: 25 }));

    expect(consume.consumeDueShipments).toHaveBeenCalledWith({ limit: 25 });
  });

  it('should skip cleanly when the lock is already held', async () => {
    // A concurrent run is a normal condition, not a failure — reporting it as
    // one would make an operator chase a healthy pass.
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });

    expect(consume.consumeDueShipments).not.toHaveBeenCalled();
    expect(syncLock.release).not.toHaveBeenCalled();
  });

  it('should wrap a failure in SyncJobExecutionError and still release the lock', async () => {
    // Nothing is persisted on this path — there is no cursor to hold — so the
    // candidates keep their NULL markers and the next tick re-reads them.
    consume.consumeDueShipments.mockRejectedValue(new Error('ledger unavailable'));

    await expect(handler.execute(makeJob())).rejects.toThrow(SyncJobExecutionError);

    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'lock-token');
  });

  it('should not fail the job when releasing the lock throws', async () => {
    syncLock.release.mockRejectedValue(new Error('redis gone'));

    await expect(handler.execute(makeJob())).resolves.toEqual({ outcome: 'ok' });
  });
});
