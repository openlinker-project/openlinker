/**
 * Cursors Controller Unit Tests
 *
 * @module apps/api/src/cursors/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CursorsController } from './cursors.controller';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import type { ConnectionCursorRepositoryPort, ConnectionCursor } from '@openlinker/core/sync';

describe('CursorsController', () => {
  let controller: CursorsController;
  let repository: jest.Mocked<ConnectionCursorRepositoryPort>;

  const mockCursor: ConnectionCursor = {
    connectionId: 'conn-001',
    cursorKey: 'allegro.orders.lastEventId',
    value: 'evt-12345',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-10T12:00:00Z'),
  };

  beforeEach(async () => {
    const mockRepository: jest.Mocked<ConnectionCursorRepositoryPort> = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CursorsController],
      providers: [
        {
          provide: CONNECTION_CURSOR_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
      ],
    }).compile();

    controller = module.get<CursorsController>(CursorsController);
    repository = module.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
  });

  describe('listCursors', () => {
    it('should return paginated cursors', async () => {
      repository.findMany.mockResolvedValue({ items: [mockCursor], total: 1 });

      const result = await controller.listCursors({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].connectionId).toBe('conn-001');
      expect(result.items[0].cursorKey).toBe('allegro.orders.lastEventId');
      expect(result.items[0].value).toBe('evt-12345');
      expect(result.items[0].updatedAt).toBe('2026-04-10T12:00:00.000Z');
    });

    it('should pass connectionId filter to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listCursors({
        connectionId: 'conn-001',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        { connectionId: 'conn-001' },
        { limit: 10, offset: 5 },
      );
    });

    it('should return empty list when no cursors match', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listCursors({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getCursor', () => {
    it('should return cursor when found', async () => {
      repository.findOne.mockResolvedValue(mockCursor);

      const result = await controller.getCursor('conn-001', 'allegro.orders.lastEventId');

      expect(result.connectionId).toBe('conn-001');
      expect(result.cursorKey).toBe('allegro.orders.lastEventId');
      expect(result.value).toBe('evt-12345');
      expect(result.createdAt).toBe('2026-04-01T00:00:00.000Z');
    });

    it('should throw NotFoundException when cursor not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        controller.getCursor('conn-999', 'nonexistent.key'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
