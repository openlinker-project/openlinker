/**
 * Connection Controller Unit Tests
 *
 * Unit tests for ConnectionController, verifying HTTP endpoint
 * handling, request validation, and response formatting.
 *
 * @module apps/api/src/integrations/http
 */
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from '../application/services/connection.service';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { ConnectionDiagnosticsResponseDto } from './dto/connection-diagnostics-response.dto';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';

describe('ConnectionController', () => {
  let controller: ConnectionController;
  let service: jest.Mocked<ConnectionService>;
  let syncJobRepository: jest.Mocked<SyncJobRepositoryPort>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date('2025-01-01'),
    new Date('2025-01-01'),
  
    undefined,
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
  );

  const makeSyncJob = (overrides: Partial<SyncJob> = {}): SyncJob =>
    new SyncJob(
      /* id           */ overrides.id ?? 'job-1',
      /* jobType      */ overrides.jobType ?? 'marketplace.orders.poll',
      /* connectionId */ 'connection-123',
      /* payload      */ {},
      /* status       */ overrides.status ?? 'succeeded',
      /* idempotencyKey */ overrides.idempotencyKey ?? 'key-1',
      /* attempts     */ overrides.attempts ?? 1,
      /* maxAttempts  */ 10,
      /* nextRunAt    */ new Date('2025-01-01T10:00:00Z'),
      /* lockedAt     */ null,
      /* lockedBy     */ null,
      /* lastError    */ overrides.lastError ?? null,
      /* createdAt    */ overrides.createdAt ?? new Date('2025-01-01T10:00:00Z'),
      /* updatedAt    */ overrides.updatedAt ?? new Date('2025-01-01T10:01:00Z'),
    );

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionService>;

    const mockSyncJobRepository: jest.Mocked<SyncJobRepositoryPort> = {
      createIfNotExistsByIdempotencyKey: jest.fn(),
      findAndLockDueJobs: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
      markSucceeded: jest.fn(),
      markFailed: jest.fn(),
      markDead: jest.fn(),
      requeueStuckJobs: jest.fn(),
      requeueDeadJob: jest.fn(),
      findRecentByConnectionId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        {
          provide: ConnectionService,
          useValue: mockService,
        },
        {
          provide: SYNC_JOB_REPOSITORY_TOKEN,
          useValue: mockSyncJobRepository,
        },
        {
          provide: INTEGRATIONS_SERVICE_TOKEN,
          useValue: {
            resolveAdapterMetadata: jest.fn().mockResolvedValue({
              adapterKey: 'prestashop.webservice.v1',
              platformType: 'prestashop',
              supportedCapabilities: ['ProductMaster'],
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<ConnectionController>(ConnectionController);
    service = module.get(ConnectionService);
    syncJobRepository = module.get(SYNC_JOB_REPOSITORY_TOKEN);
  });

  describe('create', () => {
    it('should create connection and return DTO', async () => {
      service.create.mockResolvedValue(mockConnection);

      const dto = {
        name: 'Test Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://example.com' },
        credentialsRef: 'cred_123',
      };

      const result = await controller.create(dto);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.id).toBe('connection-123');
      expect(result.name).toBe('Test Connection');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('list', () => {
    it('should return list of connection DTOs', async () => {
      service.list.mockResolvedValue([mockConnection]);

      const result = await controller.list({});

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ConnectionResponseDto);
      expect(result[0].id).toBe('connection-123');
    });

    it('should pass filters to service', async () => {
      service.list.mockResolvedValue([mockConnection]);

      await controller.list({ platformType: 'prestashop' });

      expect(service.list).toHaveBeenCalledWith({
        platformType: 'prestashop',
      });
    });
  });

  describe('get', () => {
    it('should return connection DTO', async () => {
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123');

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.id).toBe('connection-123');
      expect(service.get).toHaveBeenCalledWith('connection-123');
    });
  });

  describe('update', () => {
    it('should update connection and return DTO', async () => {
      const updatedConnection = new Connection(
        'connection-123',
        'prestashop',
        'Updated Name',
        'active',
        {},
        'cred_123',
        new Date(),
        new Date(),
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
      );

      service.update.mockResolvedValue(updatedConnection);

      const dto = { name: 'Updated Name' };
      const result = await controller.update('connection-123', dto);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.name).toBe('Updated Name');
      expect(service.update).toHaveBeenCalledWith('connection-123', {
        name: 'Updated Name',
      });
    });

    it('should handle partial updates', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { status: 'disabled' as const };
      await controller.update('connection-123', dto);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        status: 'disabled',
      });
    });
  });

  describe('disable', () => {
    it('should disable connection and return DTO', async () => {
      const disabledConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'disabled',
        {},
        'cred_123',
        new Date(),
        new Date(),
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
      );

      service.disable.mockResolvedValue(disabledConnection);

      const result = await controller.disable('connection-123');

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.status).toBe('disabled');
      expect(service.disable).toHaveBeenCalledWith('connection-123');
    });
  });

  describe('getDiagnostics', () => {
    it('should return diagnostics DTO for existing connection', async () => {
      const succeededJob = makeSyncJob({ status: 'succeeded', updatedAt: new Date('2025-01-01T10:01:00Z') });
      service.get.mockResolvedValue(mockConnection);
      syncJobRepository.findRecentByConnectionId.mockResolvedValue([succeededJob]);

      const result = await controller.getDiagnostics('connection-123');

      expect(result).toBeInstanceOf(ConnectionDiagnosticsResponseDto);
      expect(result.connectionId).toBe('connection-123');
      expect(result.connectionName).toBe('Test Connection');
      expect(result.connectionStatus).toBe('active');
      expect(result.lastSucceededAt).toBe('2025-01-01T10:01:00.000Z');
      expect(result.lastFailedAt).toBeNull();
      expect(result.recentJobs).toHaveLength(1);
      expect(syncJobRepository.findRecentByConnectionId).toHaveBeenCalledWith('connection-123', 10);
    });

    it('should throw NotFoundException for unknown connection', async () => {
      service.get.mockRejectedValue(new NotFoundException('Connection not found'));

      await expect(controller.getDiagnostics('unknown-id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should derive lastFailedAt from retrying job with lastError (markFailed sets status queued)', async () => {
      // markFailed() re-queues jobs as 'queued', so 'failed' status never appears.
      // The filter uses lastError !== null to capture retrying failures.
      const retryingJob = makeSyncJob({
        status: 'queued',
        lastError: 'Timeout',
        updatedAt: new Date('2025-01-01T11:00:00Z'),
      });
      service.get.mockResolvedValue(mockConnection);
      syncJobRepository.findRecentByConnectionId.mockResolvedValue([retryingJob]);

      const result = await controller.getDiagnostics('connection-123');

      expect(result.lastFailedAt).toBe('2025-01-01T11:00:00.000Z');
      expect(result.lastSucceededAt).toBeNull();
      expect(result.recentErrors).toEqual(['Timeout']);
    });

    it('should return empty diagnostics when no jobs exist', async () => {
      service.get.mockResolvedValue(mockConnection);
      syncJobRepository.findRecentByConnectionId.mockResolvedValue([]);

      const result = await controller.getDiagnostics('connection-123');

      expect(result.recentJobs).toHaveLength(0);
      expect(result.lastSucceededAt).toBeNull();
      expect(result.lastFailedAt).toBeNull();
      expect(result.recentErrors).toHaveLength(0);
    });
  });
});
