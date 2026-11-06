/**
 * Cursors Controller Unit Tests
 *
 * @module apps/api/src/cursors/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CursorsController } from './cursors.controller';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  CURSOR_OVERVIEW_SERVICE_TOKEN,
  CursorRewindRefusedError,
} from '@openlinker/core/sync';
import type {
  ConnectionCursorRepositoryPort,
  ConnectionCursor,
  ICursorOverviewService,
} from '@openlinker/core/sync';

describe('CursorsController', () => {
  let controller: CursorsController;
  let repository: jest.Mocked<ConnectionCursorRepositoryPort>;
  let overview: jest.Mocked<ICursorOverviewService>;

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
      advanceIfGreater: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      findMostRecentUpdate: jest.fn(),
      summarizeByKeyPrefix: jest.fn(),
    };
    overview = { getOverview: jest.fn(), rewind: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CursorsController],
      providers: [
        {
          provide: CONNECTION_CURSOR_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        { provide: CURSOR_OVERVIEW_SERVICE_TOKEN, useValue: overview },
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
        { limit: 10, offset: 5 }
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

      await expect(controller.getCursor('conn-999', 'nonexistent.key')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getOverview', () => {
    it('should serialise dates as ISO strings when the service returns an overview', async () => {
      overview.getOverview.mockResolvedValue({
        truncated: false,
        connections: [
          {
            connectionId: 'conn-001',
            cursors: [
              {
                cursorKey: 'allegro.orders.lastEventId',
                value: 'evt-1',
                createdAt: new Date('2026-04-01T00:00:00Z'),
                updatedAt: new Date('2026-04-10T12:00:00Z'),
                family: 'event-bookmark',
                rewind: null,
                lastRun: {
                  jobId: 'job-1',
                  jobType: 'marketplace.orders.poll',
                  status: 'dead',
                  outcome: null,
                  at: new Date('2026-04-10T12:05:00Z'),
                  lastError: '401 Unauthorized',
                },
              },
            ],
            writeMarks: null,
          },
        ],
      });

      const result = await controller.getOverview();

      expect(result.connections[0].cursors[0].updatedAt).toBe('2026-04-10T12:00:00.000Z');
      expect(result.connections[0].cursors[0].lastRun?.at).toBe('2026-04-10T12:05:00.000Z');
      expect(result.connections[0].cursors[0].lastRun?.lastError).toBe('401 Unauthorized');
    });
  });

  describe('rewind', () => {
    const body = { cursorKey: 'master.product.sweep:connection:conn-001', target: 'restart-pass' as const };

    it('should return the result when the service rewinds', async () => {
      overview.rewind.mockResolvedValue({ connectionId: 'conn-001', cursorKey: body.cursorKey, previousValue: 'c:10', value: '' });

      await expect(controller.rewind('conn-001', body)).resolves.toMatchObject({ value: '' });
    });

    it.each([
      ['cursor-not-found', NotFoundException],
      ['pass-not-open', ConflictException],
      ['run-in-progress', ConflictException],
      ['not-rewindable', BadRequestException],
      ['target-mismatch', BadRequestException],
    ] as const)('should map %s to the matching HTTP error when the service refuses', async (reason, Expected) => {
      overview.rewind.mockRejectedValue(new CursorRewindRefusedError(reason, body.cursorKey, 'refused'));

      await expect(controller.rewind('conn-001', body)).rejects.toBeInstanceOf(Expected);
    });
  });
});
