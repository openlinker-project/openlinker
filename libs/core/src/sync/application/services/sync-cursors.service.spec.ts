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
  let repository: jest.Mocked<Pick<ConnectionCursorRepositoryPort, 'get' | 'set' | 'delete' | 'findMany'>>;
  let service: SyncCursorsService;

  beforeEach(() => {
    repository = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
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

  describe('deleteCursor', () => {
    it('forwards (connectionId, cursorKey) to repository.delete', async () => {
      repository.delete.mockResolvedValue(undefined);

      await service.deleteCursor('conn-1', 'orders.syncStart');

      expect(repository.delete).toHaveBeenCalledWith('conn-1', 'orders.syncStart');
    });
  });

  describe('hasOrderFeedCursor (#4228)', () => {
    const page = (keys: string[]): { items: Array<{ cursorKey: string }> } => ({
      items: keys.map((cursorKey) => ({ cursorKey })),
    });

    it('is true when the connection has an order feed position', async () => {
      repository.findMany.mockResolvedValue(page(['prestashop.orders.dateUpd']) as never);

      await expect(service.hasOrderFeedCursor('conn-1')).resolves.toBe(true);
    });

    it('is false when only keys that are not order feed positions exist', async () => {
      repository.findMany.mockResolvedValue(
        page(['master.product.sweep:connection:conn-1', 'orders.syncStart']) as never
      );

      await expect(service.hasOrderFeedCursor('conn-1')).resolves.toBe(false);
    });
  });
});
