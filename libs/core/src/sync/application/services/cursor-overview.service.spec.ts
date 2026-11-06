/**
 * Cursor Overview Service Unit Tests (#4023)
 */
import { CursorOverviewService } from './cursor-overview.service';
import { CursorRewindRefusedError } from '../../domain/exceptions/cursor-rewind-refused.error';
import type { ConnectionCursorRepositoryPort } from '../../domain/ports/connection-cursor-repository.port';
import type { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { SyncLockPort } from '../ports/sync-lock.port';
import type { ConnectionCursor } from '../../domain/types/connection-cursor.types';

const AT = new Date('2026-11-06T10:00:00Z');
const cursor = (connectionId: string, cursorKey: string, value: string): ConnectionCursor => ({
  connectionId,
  cursorKey,
  value,
  createdAt: AT,
  updatedAt: AT,
});

function setup(): {
  service: CursorOverviewService;
  cursors: jest.Mocked<Pick<ConnectionCursorRepositoryPort, 'findMany' | 'summarizeByKeyPrefix' | 'findOne' | 'set'>>;
  jobs: jest.Mocked<Pick<SyncJobRepositoryPort, 'findLatestByConnectionsAndJobTypes'>>;
  locks: jest.Mocked<Pick<SyncLockPort, 'acquire' | 'release'>>;
} {
  const cursors = {
    findMany: jest.fn(),
    summarizeByKeyPrefix: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    set: jest.fn(),
  };
  const jobs = { findLatestByConnectionsAndJobTypes: jest.fn().mockResolvedValue([]) };
  const locks = { acquire: jest.fn(), release: jest.fn().mockResolvedValue(true) };
  const service = new CursorOverviewService(
    cursors as unknown as ConnectionCursorRepositoryPort,
    jobs as unknown as SyncJobRepositoryPort,
    locks as unknown as SyncLockPort,
  );
  return { service, cursors, jobs, locks };
}

describe('CursorOverviewService', () => {
  describe('getOverview', () => {
    it('should pair each cursor with the latest run of its writer job when one exists', async () => {
      const { service, cursors, jobs } = setup();
      cursors.findMany.mockResolvedValue({ items: [cursor('c1', 'allegro.orders.lastEventId', '42')], total: 1 });
      jobs.findLatestByConnectionsAndJobTypes.mockResolvedValue([
        { id: 'j1', connectionId: 'c1', jobType: 'marketplace.orders.poll', status: 'dead', outcome: null, updatedAt: AT, lastError: '401' } as never,
      ]);

      const result = await service.getOverview();

      expect(result.connections[0].cursors[0].lastRun).toMatchObject({ jobId: 'j1', status: 'dead', lastError: '401' });
      expect(result.connections[0].cursors[0].family).toBe('event-bookmark');
    });

    it('should exclude write marks from the list and summarise them per connection', async () => {
      const { service, cursors } = setup();
      cursors.findMany.mockResolvedValue({ items: [], total: 0 });
      cursors.summarizeByKeyPrefix.mockResolvedValue([
        { connectionId: 'c2', count: 3, oldestValue: 'a', newestValue: 'z', lastUpdatedAt: AT },
      ]);

      const result = await service.getOverview();

      expect(cursors.findMany.mock.calls[0][0]).toEqual({ excludeKeyPrefix: 'inventory.offerQuantity.observedAt:offer:' });
      expect(result.connections).toEqual([
        expect.objectContaining({ connectionId: 'c2', cursors: [], writeMarks: expect.objectContaining({ count: 3 }) }),
      ]);
    });

    it('should report truncation when more cursors exist than were read', async () => {
      const { service, cursors } = setup();
      cursors.findMany.mockResolvedValue({ items: [cursor('c1', 'allegro.orders.lastEventId', '1')], total: 5000 });

      await expect(service.getOverview()).resolves.toMatchObject({ truncated: true });
    });
  });

  describe('rewind', () => {
    const passKey = 'master.product.sweep:connection:c1';

    it('should clear an open pass under the sweep lock when no run holds it', async () => {
      const { service, cursors, locks } = setup();
      cursors.findOne.mockResolvedValue(cursor('c1', passKey, 'cycle:120'));
      locks.acquire.mockResolvedValue('tok' as never);

      const result = await service.rewind({ connectionId: 'c1', cursorKey: passKey, target: 'restart-pass' });

      expect(locks.acquire).toHaveBeenCalledWith('master:product:sweep:c1', expect.any(Number));
      expect(cursors.set).toHaveBeenCalledWith('c1', passKey, '');
      expect(locks.release).toHaveBeenCalledWith('master:product:sweep:c1', 'tok');
      expect(result).toMatchObject({ previousValue: 'cycle:120', value: '' });
    });

    it('should refuse with run-in-progress when the sweep lock is held', async () => {
      const { service, cursors, locks } = setup();
      cursors.findOne.mockResolvedValue(cursor('c1', passKey, 'cycle:120'));
      locks.acquire.mockResolvedValue(null);

      await expect(service.rewind({ connectionId: 'c1', cursorKey: passKey, target: 'restart-pass' })).rejects.toMatchObject({
        reason: 'run-in-progress',
      });
      expect(cursors.set).not.toHaveBeenCalled();
    });

    it('should refuse with pass-not-open when the pass already finished', async () => {
      const { service, cursors } = setup();
      cursors.findOne.mockResolvedValue(cursor('c1', passKey, ''));

      await expect(service.rewind({ connectionId: 'c1', cursorKey: passKey, target: 'restart-pass' })).rejects.toMatchObject({
        reason: 'pass-not-open',
      });
    });

    it('should reset a rolling re-check to 0 when asked to restart the check', async () => {
      const { service, cursors } = setup();
      cursors.findOne.mockResolvedValue(cursor('c1', 'allegro.offerStatus.scanOffset', '600'));

      await service.rewind({ connectionId: 'c1', cursorKey: 'allegro.offerStatus.scanOffset', target: 'restart-check' });

      expect(cursors.set).toHaveBeenCalledWith('c1', 'allegro.offerStatus.scanOffset', '0');
    });

    it.each([
      ['allegro.orders.lastEventId', 'restart-check', 'not-rewindable'],
      ['custom.plugin.cursor', 'restart-check', 'not-rewindable'],
      ['allegro.offerStatus.scanOffset', 'restart-pass', 'target-mismatch'],
    ] as const)('should refuse %s with %s as %s', async (cursorKey, target, reason) => {
      const { service } = setup();

      const error = await service.rewind({ connectionId: 'c1', cursorKey, target }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CursorRewindRefusedError);
      expect(error).toMatchObject({ reason });
    });

    it('should refuse with cursor-not-found when the cursor does not exist', async () => {
      const { service, cursors } = setup();
      cursors.findOne.mockResolvedValue(null);

      await expect(
        service.rewind({ connectionId: 'c1', cursorKey: 'allegro.offerStatus.scanOffset', target: 'restart-check' }),
      ).rejects.toMatchObject({ reason: 'cursor-not-found' });
    });
  });
});
