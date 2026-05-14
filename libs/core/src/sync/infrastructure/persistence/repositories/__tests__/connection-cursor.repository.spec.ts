/**
 * Connection Cursor Repository Unit Tests
 *
 * Unit tests for ConnectionCursorRepository, verifying cursor persistence operations,
 * error handling, and idempotency of set operations.
 *
 * @module libs/core/src/sync/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, InsertResult } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { ConnectionCursorRepository } from '../connection-cursor.repository';
import { ConnectionCursorOrmEntity } from '../../entities/connection-cursor.orm-entity';
import { randomUUID } from 'crypto';

describe('ConnectionCursorRepository', () => {
  let repository: ConnectionCursorRepository;
  let ormRepository: jest.Mocked<Repository<ConnectionCursorOrmEntity>>;

  beforeEach(async () => {
    // Mock Repository
    const mockOrmRepository = {
      findOne: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<ConnectionCursorOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionCursorRepository,
        {
          provide: getRepositoryToken(ConnectionCursorOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<ConnectionCursorRepository>(ConnectionCursorRepository);
    ormRepository = module.get(getRepositoryToken(ConnectionCursorOrmEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    const connectionId = randomUUID();
    const cursorKey = 'allegro.orders.lastEventId';
    const cursorValue = 'event-123';

    it('should return cursor value when cursor exists', async () => {
      const entity = new ConnectionCursorOrmEntity();
      entity.connectionId = connectionId;
      entity.cursorKey = cursorKey;
      entity.value = cursorValue;
      entity.createdAt = new Date();
      entity.updatedAt = new Date();

      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.get(connectionId, cursorKey);

      expect(result).toBe(cursorValue);
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId, cursorKey },
      });
    });

    it('should return null when cursor does not exist', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.get(connectionId, cursorKey);

      expect(result).toBeNull();
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId, cursorKey },
      });
    });

    it('should return null and log warning when QueryFailedError occurs (invalid UUID)', async () => {
      const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
      ormRepository.findOne.mockRejectedValue(error);

      const result = await repository.get('invalid-uuid', cursorKey);

      expect(result).toBeNull();
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId: 'invalid-uuid', cursorKey },
      });
    });

    it('should re-throw non-QueryFailedError exceptions', async () => {
      const error = new Error('Unexpected database error');
      ormRepository.findOne.mockRejectedValue(error);

      await expect(repository.get(connectionId, cursorKey)).rejects.toThrow(
        'Unexpected database error'
      );
    });
  });

  describe('set', () => {
    const connectionId = randomUUID();
    const cursorKey = 'allegro.orders.lastEventId';
    const cursorValue = 'event-456';

    it('should create new cursor when cursor does not exist', async () => {
      const insertResult: InsertResult = {
        identifiers: [],
        generatedMaps: [],
        raw: [],
      };
      ormRepository.upsert.mockResolvedValue(insertResult);

      await repository.set(connectionId, cursorKey, cursorValue);

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        {
          connectionId,
          cursorKey,
          value: cursorValue,
        },
        {
          conflictPaths: ['connectionId', 'cursorKey'],
        }
      );
    });

    it('should update existing cursor when cursor exists (idempotent)', async () => {
      const insertResult: InsertResult = {
        identifiers: [],
        generatedMaps: [],
        raw: [],
      };
      ormRepository.upsert.mockResolvedValue(insertResult);

      await repository.set(connectionId, cursorKey, 'new-value');

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        {
          connectionId,
          cursorKey,
          value: 'new-value',
        },
        {
          conflictPaths: ['connectionId', 'cursorKey'],
        }
      );
    });

    it('should throw error when QueryFailedError occurs (invalid UUID)', async () => {
      const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
      ormRepository.upsert.mockRejectedValue(error);

      await expect(repository.set('invalid-uuid', cursorKey, cursorValue)).rejects.toThrow(
        'Failed to set cursor'
      );

      expect(ormRepository.upsert).toHaveBeenCalled();
    });

    it('should re-throw non-QueryFailedError exceptions', async () => {
      const error = new Error('Unexpected database error');
      ormRepository.upsert.mockRejectedValue(error);

      await expect(repository.set(connectionId, cursorKey, cursorValue)).rejects.toThrow(
        'Unexpected database error'
      );
    });
  });

  describe('delete', () => {
    const connectionId = randomUUID();
    const cursorKey = 'allegro.orders.lastEventId';

    it('should delete cursor when cursor exists', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

      await repository.delete(connectionId, cursorKey);

      expect(ormRepository.delete).toHaveBeenCalledWith({
        connectionId,
        cursorKey,
      });
    });

    it('should succeed when cursor does not exist (idempotent)', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 0, raw: [] });

      await repository.delete(connectionId, cursorKey);

      expect(ormRepository.delete).toHaveBeenCalledWith({
        connectionId,
        cursorKey,
      });
    });

    it('should swallow QueryFailedError and return (idempotent delete)', async () => {
      const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
      ormRepository.delete.mockRejectedValue(error);

      // Should not throw
      await expect(repository.delete('invalid-uuid', cursorKey)).resolves.toBeUndefined();

      expect(ormRepository.delete).toHaveBeenCalledWith({
        connectionId: 'invalid-uuid',
        cursorKey,
      });
    });

    it('should re-throw non-QueryFailedError exceptions', async () => {
      const error = new Error('Unexpected database error');
      ormRepository.delete.mockRejectedValue(error);

      await expect(repository.delete(connectionId, cursorKey)).rejects.toThrow(
        'Unexpected database error'
      );
    });
  });
});
