/**
 * Sync Cursors Service Unit Tests
 *
 * Pass-through assertions for `getCursor` / `advanceCursor` — verifies
 * the service forwards `(connectionId, cursorKey[, value])` to the
 * underlying repository unchanged.
 *
 * @module libs/core/src/sync/application/services
 */
import { SyncCursorsService } from './sync-cursors.service';
import type { ConnectionCursorRepositoryPort } from '../../domain/ports/connection-cursor-repository.port';

describe('SyncCursorsService', () => {
  let repository: jest.Mocked<Pick<ConnectionCursorRepositoryPort, 'get' | 'set'>>;
  let service: SyncCursorsService;

  beforeEach(() => {
    repository = {
      get: jest.fn(),
      set: jest.fn(),
    };
    service = new SyncCursorsService(repository as unknown as ConnectionCursorRepositoryPort);
  });

  describe('getCursor', () => {
    it('forwards (connectionId, cursorKey) to the repository and returns the value', async () => {
      repository.get.mockResolvedValue('cursor-42');

      const result = await service.getCursor('conn-1', 'allegro.orders.lastEventId');

      expect(result).toBe('cursor-42');
      expect(repository.get).toHaveBeenCalledWith('conn-1', 'allegro.orders.lastEventId');
    });

    it('returns null when the repository has no row for the pair', async () => {
      repository.get.mockResolvedValue(null);

      const result = await service.getCursor('conn-1', 'missing');

      expect(result).toBeNull();
    });
  });

  describe('advanceCursor', () => {
    it('forwards (connectionId, cursorKey, value) to repository.set', async () => {
      repository.set.mockResolvedValue(undefined);

      await service.advanceCursor('conn-1', 'allegro.orders.lastEventId', 'cursor-99');

      expect(repository.set).toHaveBeenCalledWith(
        'conn-1',
        'allegro.orders.lastEventId',
        'cursor-99'
      );
    });
  });
});
