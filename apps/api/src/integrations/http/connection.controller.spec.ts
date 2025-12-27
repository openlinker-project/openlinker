/**
 * Connection Controller Unit Tests
 *
 * Unit tests for ConnectionController, verifying HTTP endpoint
 * handling, request validation, and response formatting.
 *
 * @module apps/api/src/integrations/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from '../application/services/connection.service';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionResponseDto } from './dto/connection-response.dto';

describe('ConnectionController', () => {
  let controller: ConnectionController;
  let service: jest.Mocked<ConnectionService>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date('2025-01-01'),
    new Date('2025-01-01'),
  );

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        {
          provide: ConnectionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ConnectionController>(ConnectionController);
    service = module.get(ConnectionService);
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
      );

      service.disable.mockResolvedValue(disabledConnection);

      const result = await controller.disable('connection-123');

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.status).toBe('disabled');
      expect(service.disable).toHaveBeenCalledWith('connection-123');
    });
  });
});

