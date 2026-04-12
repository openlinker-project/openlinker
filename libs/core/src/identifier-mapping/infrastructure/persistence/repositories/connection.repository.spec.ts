/**
 * Connection Repository Unit Tests
 *
 * Unit tests for ConnectionRepository, verifying CRUD operations,
 * error handling, and domain entity mapping.
 *
 * @module libs/core/src/identifier-mapping/infrastructure/persistence/repositories
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ConnectionRepository } from './connection.repository';
import { ConnectionOrmEntity } from '../entities/connection.orm-entity';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-not-found.exception';
import {
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping/domain/types/connection.types';

describe('ConnectionRepository', () => {
  let repository: ConnectionRepository;
  let ormRepository: jest.Mocked<Repository<ConnectionOrmEntity>>;

  const mockOrmEntity: ConnectionOrmEntity = {
    id: 'connection-123',
    platformType: 'prestashop',
    name: 'Test Connection',
    status: 'active',
    config: { baseUrl: 'https://example.com' },
    credentialsRef: 'cred_123',
    adapterKey: 'prestashop.webservice.v1',
    enabledCapabilities: ['ProductMaster'],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockDomainEntity = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date('2025-01-01'),
    new Date('2025-01-01'),
    'prestashop.webservice.v1',
    ['ProductMaster'],
  );

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<ConnectionOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionRepository,
        {
          provide: getRepositoryToken(ConnectionOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<ConnectionRepository>(ConnectionRepository);
    ormRepository = module.get(getRepositoryToken(ConnectionOrmEntity));
  });

  describe('get', () => {
    it('should return connection when found', async () => {
      ormRepository.findOne.mockResolvedValue(mockOrmEntity);

      const result = await repository.get('connection-123');

      expect(result).toEqual(mockDomainEntity);
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'connection-123' },
      });
    });

    it('should throw ConnectionNotFoundException when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.get('non-existent')).rejects.toThrow(
        ConnectionNotFoundException,
      );
    });
  });

  describe('list', () => {
    it('should return all connections when no filters provided', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockOrmEntity]),
      } as unknown as SelectQueryBuilder<ConnectionOrmEntity>;
      ormRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await repository.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockDomainEntity);
      expect(ormRepository.createQueryBuilder).toHaveBeenCalledWith('connection');
    });

    it('should filter by platformType', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockOrmEntity]),
      } as unknown as SelectQueryBuilder<ConnectionOrmEntity>;
      ormRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const filters: ConnectionFilters = { platformType: 'prestashop' };
      await repository.list(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'connection.platformType = :platformType',
        { platformType: 'prestashop' },
      );
    });

    it('should filter by status', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockOrmEntity]),
      } as unknown as SelectQueryBuilder<ConnectionOrmEntity>;
      ormRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const filters: ConnectionFilters = { status: 'active' };
      await repository.list(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'connection.status = :status',
        { status: 'active' },
      );
    });

    it('should filter by both platformType and status', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockOrmEntity]),
      } as unknown as SelectQueryBuilder<ConnectionOrmEntity>;
      ormRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const filters: ConnectionFilters = {
        platformType: 'prestashop',
        status: 'active',
      };
      await repository.list(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe('create', () => {
    it('should create and return new connection', async () => {
      const createPayload: ConnectionCreate = {
        name: 'New Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://new.com' },
        credentialsRef: 'cred_new',
        enabledCapabilities: ['ProductMaster'],
      };

      const savedEntity = {
        ...mockOrmEntity,
        id: 'connection-new',
        name: 'New Connection',
        status: 'active',
      };
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.create(createPayload);

      expect(result).toBeDefined();
      expect(result.name).toBe('New Connection');
      expect(result.status).toBe('active');
      expect(ormRepository.save).toHaveBeenCalled();
    });

    it('should create connection with adapterKey when provided', async () => {
      const createPayload: ConnectionCreate = {
        name: 'New Connection',
        platformType: 'prestashop',
        config: {},
        credentialsRef: 'cred_new',
        adapterKey: 'prestashop.webservice.v2',
        enabledCapabilities: ['ProductMaster'],
      };

      const savedEntity = {
        ...mockOrmEntity,
        adapterKey: 'prestashop.webservice.v2',
      };
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.create(createPayload);

      expect(result.adapterKey).toBe('prestashop.webservice.v2');
    });
  });

  describe('update', () => {
    it('should update connection and return updated entity', async () => {
      const freshEntity = { ...mockOrmEntity };
      ormRepository.findOne.mockResolvedValue(freshEntity);
      const updatedEntity = {
        ...freshEntity,
        name: 'Updated Name',
      };
      ormRepository.save.mockResolvedValue(updatedEntity);

      const patch: ConnectionUpdate = { name: 'Updated Name' };
      const result = await repository.update('connection-123', patch);

      expect(result.name).toBe('Updated Name');
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'connection-123' },
      });
      expect(ormRepository.save).toHaveBeenCalled();
    });

    it('should throw ConnectionNotFoundException when connection does not exist', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.update('non-existent', { name: 'Updated' }),
      ).rejects.toThrow(ConnectionNotFoundException);
    });

    it('should update only provided fields', async () => {
      // Create a fresh copy to avoid mutation from previous tests
      const freshEntity: ConnectionOrmEntity = {
        ...mockOrmEntity,
        name: 'Test Connection', // Ensure name is set correctly
      };
      ormRepository.findOne.mockResolvedValue(freshEntity);
      // Mock save to return the entity that was passed (with modifications)
      ormRepository.save.mockImplementation((entity) => {
        return Promise.resolve(entity as ConnectionOrmEntity);
      });

      const patch: ConnectionUpdate = { status: 'disabled' };
      const result = await repository.update('connection-123', patch);

      expect(result.status).toBe('disabled');
      expect(result.name).toBe('Test Connection'); // Unchanged
      // Verify that save was called with entity that has status updated but name unchanged
      expect(ormRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'disabled',
          name: 'Test Connection',
        }),
      );
    });
  });

  describe('disable', () => {
    it('should set status to disabled', async () => {
      ormRepository.findOne.mockResolvedValue(mockOrmEntity);
      const disabledEntity = {
        ...mockOrmEntity,
        status: 'disabled',
      };
      ormRepository.save.mockResolvedValue(disabledEntity);

      const result = await repository.disable('connection-123');

      expect(result.status).toBe('disabled');
    });
  });
});

