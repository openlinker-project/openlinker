/**
 * Allegro Quantity Command Repository Tests
 *
 * Unit tests for AllegroQuantityCommandRepository. Tests CRUD operations,
 * duplicate handling, query filters, and error cases.
 *
 * @module libs/integrations/allegro/src/infrastructure/persistence/repositories/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { AllegroQuantityCommandRepository } from '../allegro-quantity-command.repository';
import { AllegroQuantityCommandOrmEntity } from '../../entities/allegro-quantity-command.orm-entity';
import { AllegroQuantityCommand } from '../../../../domain/entities/allegro-quantity-command.entity';
import { DuplicateAllegroQuantityCommandError } from '../../../../domain/exceptions/duplicate-allegro-quantity-command.error';
import { AllegroQuantityCommandNotFoundException } from '../../../../domain/exceptions/allegro-quantity-command-not-found.error';
import { randomUUID } from 'crypto';

describe('AllegroQuantityCommandRepository', () => {
  let repository: AllegroQuantityCommandRepository;
  let ormRepository: jest.Mocked<Repository<AllegroQuantityCommandOrmEntity>>;

  const createOrmEntity = (
    overrides: Partial<AllegroQuantityCommandOrmEntity> = {}
  ): AllegroQuantityCommandOrmEntity => {
    const entity = new AllegroQuantityCommandOrmEntity();
    entity.id = overrides.id || randomUUID();
    entity.commandId = overrides.commandId || 'cmd-123';
    entity.connectionId = overrides.connectionId || randomUUID();
    entity.offerId = overrides.offerId || 'offer-456';
    entity.quantity = overrides.quantity ?? 10;
    entity.status = overrides.status || 'queued';
    entity.error = overrides.error ?? null;
    entity.createdAt = overrides.createdAt || new Date();
    entity.updatedAt = overrides.updatedAt || new Date();
    return entity;
  };

  const createDomainEntity = (
    overrides: Partial<AllegroQuantityCommand> = {}
  ): AllegroQuantityCommand => {
    return AllegroQuantityCommand.create(
      overrides.commandId || 'cmd-123',
      overrides.connectionId || randomUUID(),
      overrides.offerId || 'offer-456',
      overrides.quantity ?? 10,
      overrides.status || 'queued',
      overrides.error
    );
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    } as unknown as SelectQueryBuilder<AllegroQuantityCommandOrmEntity>;

    ormRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    } as unknown as jest.Mocked<Repository<AllegroQuantityCommandOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllegroQuantityCommandRepository,
        {
          provide: getRepositoryToken(AllegroQuantityCommandOrmEntity),
          useValue: ormRepository,
        },
      ],
    }).compile();

    repository = module.get<AllegroQuantityCommandRepository>(AllegroQuantityCommandRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByCommandId', () => {
    it('should return command when found', async () => {
      const entity = createOrmEntity({ commandId: 'cmd-123' });
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findByCommandId('cmd-123');

      expect(result).toBeDefined();
      expect(result?.commandId).toBe('cmd-123');
      expect(result?.connectionId).toBe(entity.connectionId);
      expect(result?.offerId).toBe(entity.offerId);
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { commandId: 'cmd-123' },
      });
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCommandId('non-existent-cmd');

      expect(result).toBeNull();
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { commandId: 'non-existent-cmd' },
      });
    });
  });

  describe('find', () => {
    it('should return all commands when no filters provided', async () => {
      const entities = [createOrmEntity(), createOrmEntity()];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      const result = await repository.find({});

      expect(result).toHaveLength(2);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('command.createdAt', 'DESC');
    });

    it('should filter by connectionId', async () => {
      const connectionId = randomUUID();
      const entities = [createOrmEntity({ connectionId })];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      const result = await repository.find({ connectionId });

      expect(result).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'command.connectionId = :connectionId',
        { connectionId }
      );
    });

    it('should filter by status', async () => {
      const entities = [createOrmEntity({ status: 'accepted' })];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      const result = await repository.find({ status: 'accepted' });

      expect(result).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('command.status = :status', {
        status: 'accepted',
      });
    });

    it('should apply limit', async () => {
      const entities = [createOrmEntity()];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      await repository.find({ limit: 10 });

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should apply offset', async () => {
      const entities = [createOrmEntity()];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      await repository.find({ offset: 20 });

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(20);
    });

    it('should combine multiple filters', async () => {
      const connectionId = randomUUID();
      const entities = [createOrmEntity({ connectionId, status: 'failed' })];
      const mockQueryBuilder = ormRepository.createQueryBuilder() as jest.Mocked<
        SelectQueryBuilder<AllegroQuantityCommandOrmEntity>
      >;
      mockQueryBuilder.getMany.mockResolvedValue(entities);

      const result = await repository.find({
        connectionId,
        status: 'failed',
        limit: 5,
        offset: 10,
      });

      expect(result).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
    });
  });

  describe('create', () => {
    it('should create command successfully', async () => {
      const command = createDomainEntity({
        commandId: 'cmd-123',
        connectionId: randomUUID(),
        offerId: 'offer-456',
        quantity: 10,
        status: 'queued',
      });

      const savedEntity = createOrmEntity({
        id: randomUUID(),
        commandId: 'cmd-123',
        connectionId: command.connectionId,
        offerId: 'offer-456',
        quantity: 10,
        status: 'queued',
      });
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.create(command);

      expect(result).toBeDefined();
      expect(result.commandId).toBe('cmd-123');
      expect(result.connectionId).toBe(command.connectionId);
      expect(result.offerId).toBe('offer-456');
      expect(ormRepository.save).toHaveBeenCalled();
    });

    it('should throw DuplicateAllegroQuantityCommandError on unique constraint violation', async () => {
      const command = createDomainEntity({ commandId: 'cmd-123' });
      const duplicateError = new QueryFailedError(
        'INSERT',
        [],
        new Error('duplicate key value violates unique constraint')
      );
      duplicateError.message =
        'duplicate key value violates unique constraint "allegro_quantity_commands_commandId_key"';
      ormRepository.save.mockRejectedValue(duplicateError);

      await expect(repository.create(command)).rejects.toThrow(
        DuplicateAllegroQuantityCommandError
      );
      await expect(repository.create(command)).rejects.toThrow('cmd-123');
    });

    it('should throw DuplicateAllegroQuantityCommandError on duplicate key error', async () => {
      const command = createDomainEntity({ commandId: 'cmd-123' });
      const duplicateError = new QueryFailedError('INSERT', [], new Error('duplicate'));
      duplicateError.message = 'duplicate key value';
      ormRepository.save.mockRejectedValue(duplicateError);

      await expect(repository.create(command)).rejects.toThrow(
        DuplicateAllegroQuantityCommandError
      );
    });

    it('should re-throw non-duplicate errors', async () => {
      const command = createDomainEntity();
      const otherError = new Error('Database connection failed');
      ormRepository.save.mockRejectedValue(otherError);

      await expect(repository.create(command)).rejects.toThrow('Database connection failed');
    });
  });

  describe('updateStatus', () => {
    it('should update status successfully', async () => {
      const commandId = 'cmd-123';
      const entity = createOrmEntity({ commandId, status: 'queued' });
      const updatedEntity = createOrmEntity({ commandId, status: 'accepted' });
      ormRepository.findOne.mockResolvedValue(entity);
      ormRepository.save.mockResolvedValue(updatedEntity);

      const result = await repository.updateStatus(commandId, 'accepted');

      expect(result.status).toBe('accepted');
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { commandId },
      });
      expect(ormRepository.save).toHaveBeenCalled();
      expect(entity.status).toBe('accepted');
    });

    it('should update status and error message', async () => {
      const commandId = 'cmd-123';
      const entity = createOrmEntity({ commandId, status: 'queued', error: null });
      const updatedEntity = createOrmEntity({
        commandId,
        status: 'failed',
        error: 'Invalid quantity',
      });
      ormRepository.findOne.mockResolvedValue(entity);
      ormRepository.save.mockResolvedValue(updatedEntity);

      const result = await repository.updateStatus(commandId, 'failed', 'Invalid quantity');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Invalid quantity');
      expect(entity.status).toBe('failed');
      expect(entity.error).toBe('Invalid quantity');
    });

    it('should clear error when error is null', async () => {
      const commandId = 'cmd-123';
      const entity = createOrmEntity({ commandId, status: 'failed', error: 'Previous error' });
      const updatedEntity = createOrmEntity({ commandId, status: 'accepted', error: null });
      ormRepository.findOne.mockResolvedValue(entity);
      ormRepository.save.mockResolvedValue(updatedEntity);

      const result = await repository.updateStatus(commandId, 'accepted', null);

      expect(result.status).toBe('accepted');
      expect(result.error).toBeNull();
      expect(entity.error).toBeNull();
    });

    it('should throw AllegroQuantityCommandNotFoundException when command not found', async () => {
      const commandId = 'non-existent-cmd';
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.updateStatus(commandId, 'accepted')).rejects.toThrow(
        AllegroQuantityCommandNotFoundException
      );
      await expect(repository.updateStatus(commandId, 'accepted')).rejects.toThrow(commandId);
    });
  });
});
