/**
 * Connection Service Unit Tests
 *
 * Unit tests for ConnectionService, verifying API layer service
 * wrapper functionality and error handling.
 *
 * @module apps/api/src/integrations/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-not-found.exception';
import {
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping/domain/types/connection.types';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let connectionPort: jest.Mocked<ConnectionPort>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date(),
    new Date(),
  );

  beforeEach(async () => {
    const mockConnectionPort = {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        {
          provide: CONNECTION_PORT_TOKEN,
          useValue: mockConnectionPort,
        },
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
  });

  describe('create', () => {
    it('should create and return connection', async () => {
      const payload: ConnectionCreate = {
        name: 'New Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://new.com' },
        credentialsRef: 'cred_new',
      };

      connectionPort.create.mockResolvedValue(mockConnection);

      const result = await service.create(payload);

      expect(result).toEqual(mockConnection);
      expect(connectionPort.create).toHaveBeenCalledWith(payload);
    });
  });

  describe('list', () => {
    it('should return list of connections', async () => {
      connectionPort.list.mockResolvedValue([mockConnection]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockConnection);
    });

    it('should pass filters to port', async () => {
      const filters: ConnectionFilters = { platformType: 'prestashop' };
      connectionPort.list.mockResolvedValue([mockConnection]);

      await service.list(filters);

      expect(connectionPort.list).toHaveBeenCalledWith(filters);
    });
  });

  describe('get', () => {
    it('should return connection when found', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);

      const result = await service.get('connection-123');

      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(service.get('connection-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update and return connection', async () => {
      const patch: ConnectionUpdate = { name: 'Updated Name' };
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

      connectionPort.update.mockResolvedValue(updatedConnection);

      const result = await service.update('connection-123', patch);

      expect(result).toEqual(updatedConnection);
      expect(connectionPort.update).toHaveBeenCalledWith('connection-123', patch);
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.update.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(
        service.update('connection-123', { name: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('disable', () => {
    it('should disable and return connection', async () => {
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

      connectionPort.disable.mockResolvedValue(disabledConnection);

      const result = await service.disable('connection-123');

      expect(result.status).toBe('disabled');
      expect(connectionPort.disable).toHaveBeenCalledWith('connection-123');
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.disable.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(service.disable('connection-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});



