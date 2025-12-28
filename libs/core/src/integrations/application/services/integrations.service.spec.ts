/**
 * Integrations Service Unit Tests
 *
 * Unit tests for IntegrationsService, verifying adapter resolution,
 * capability validation, and multiple adapters per capability.
 *
 * @module libs/core/src/integrations/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';
import { AdapterRegistryPort } from '@openlinker/core/integrations/domain/ports/adapter-registry.port';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import { ADAPTER_REGISTRY_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-not-found.exception';
import { ConnectionDisabledException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-disabled.exception';
import { AdapterNotFoundException } from '@openlinker/core/integrations/domain/exceptions/adapter-not-found.exception';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations/domain/exceptions/capability-not-supported.exception';
import {
  AdapterMetadata,
  AdapterInstance,
} from '@openlinker/core/integrations/domain/types/adapter.types';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let adapterRegistry: jest.Mocked<AdapterRegistryPort>;

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

  const mockAdapterMetadata: AdapterMetadata = {
    adapterKey: 'prestashop.webservice.v1',
    platformType: 'prestashop',
    supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
    displayName: 'PrestaShop WebService v1',
    version: '1.0.0',
  };

  const mockAdapter: AdapterInstance = {
    adapterKey: 'prestashop.webservice.v1',
  } as AdapterInstance;

  beforeEach(async () => {
    const mockConnectionPort = {
      get: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    const mockAdapterRegistry = {
      getAdapter: jest.fn(),
      getAdapterMetadata: jest.fn(),
      listAdapters: jest.fn(),
    } as unknown as jest.Mocked<AdapterRegistryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        {
          provide: CONNECTION_PORT_TOKEN,
          useValue: mockConnectionPort,
        },
        {
          provide: ADAPTER_REGISTRY_TOKEN,
          useValue: mockAdapterRegistry,
        },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
    adapterRegistry = module.get(ADAPTER_REGISTRY_TOKEN);
  });

  describe('getAdapter', () => {
    it('should resolve adapter for connection with explicit adapterKey', async () => {
      const connectionWithKey = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'active',
        {},
        'cred_123',
        new Date(),
        new Date(),
        'prestashop.webservice.v1',
      );

      connectionPort.get.mockResolvedValue(connectionWithKey);
      adapterRegistry.getAdapter.mockResolvedValue(mockAdapter);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);

      const result = await service.getAdapter('connection-123');

      expect(result.connection).toEqual(connectionWithKey);
      expect(result.adapter).toEqual(mockAdapter);
      expect(result.metadata).toEqual(mockAdapterMetadata);
      expect(adapterRegistry.getAdapterMetadata).toHaveBeenCalledWith(
        'prestashop.webservice.v1',
      );
    });

    it('should derive adapterKey from platformType when not provided', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapter.mockResolvedValue(mockAdapter);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);

      const result = await service.getAdapter('connection-123');

      expect(result.connection).toEqual(mockConnection);
      expect(adapterRegistry.getAdapterMetadata).toHaveBeenCalledWith(
        'prestashop.webservice.v1',
      );
    });

    it('should throw ConnectionNotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(service.getAdapter('connection-123')).rejects.toThrow(
        ConnectionNotFoundException,
      );
    });

    it('should throw ConnectionDisabledException when connection is disabled', async () => {
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

      connectionPort.get.mockResolvedValue(disabledConnection);

      await expect(service.getAdapter('connection-123')).rejects.toThrow(
        ConnectionDisabledException,
      );
    });

    it('should throw AdapterNotFoundException when adapter key not found', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapterMetadata.mockRejectedValue(
        new AdapterNotFoundException('unknown.adapter.v1'),
      );

      await expect(service.getAdapter('connection-123')).rejects.toThrow(
        AdapterNotFoundException,
      );
    });
  });

  describe('getCapabilityAdapter', () => {
    it('should return typed adapter when capability is supported', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapter.mockResolvedValue(mockAdapter);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);

      const result = await service.getCapabilityAdapter<unknown>(
        'connection-123',
        'ProductMaster',
      );

      expect(result).toEqual(mockAdapter);
    });

    it('should throw CapabilityNotSupportedException when capability not supported', async () => {
      const metadataWithoutCapability: AdapterMetadata = {
        ...mockAdapterMetadata,
        supportedCapabilities: ['InventoryMaster'],
      };

      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapter.mockResolvedValue(mockAdapter);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(
        metadataWithoutCapability,
      );

      await expect(
        service.getCapabilityAdapter<unknown>('connection-123', 'ProductMaster'),
      ).rejects.toThrow(CapabilityNotSupportedException);
    });
  });

  describe('listCapabilityAdapters', () => {
    it('should return all adapters supporting a capability', async () => {
      const prestashopConnection = new Connection(
        'connection-1',
        'prestashop',
        'PrestaShop Store',
        'active',
        {},
        'cred_1',
        new Date(),
        new Date(),
      );

      const allegroConnection = new Connection(
        'connection-2',
        'allegro',
        'Allegro Marketplace',
        'active',
        {},
        'cred_2',
        new Date(),
        new Date(),
      );

      const prestashopMetadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderProcessorManager'],
      };

      const allegroMetadata: AdapterMetadata = {
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['OrderProcessorManager'],
      };

      connectionPort.list.mockResolvedValue([
        prestashopConnection,
        allegroConnection,
      ]);

      adapterRegistry.getAdapterMetadata
        .mockResolvedValueOnce(prestashopMetadata)
        .mockResolvedValueOnce(allegroMetadata);

      adapterRegistry.getAdapter
        .mockResolvedValueOnce({ adapterKey: 'prestashop.webservice.v1' } as AdapterInstance)
        .mockResolvedValueOnce({ adapterKey: 'allegro.publicapi.v1' } as AdapterInstance);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderProcessorManager',
      });

      expect(result).toHaveLength(2);
      expect(result[0].connectionId).toBe('connection-1');
      expect(result[1].connectionId).toBe('connection-2');
    });

    it('should filter by platformType when provided', async () => {
      const prestashopConnection = new Connection(
        'connection-1',
        'prestashop',
        'PrestaShop Store',
        'active',
        {},
        'cred_1',
        new Date(),
        new Date(),
      );

      const prestashopMetadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderProcessorManager'],
      };

      connectionPort.list.mockResolvedValue([prestashopConnection]);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(prestashopMetadata);
      adapterRegistry.getAdapter.mockResolvedValue({
        adapterKey: 'prestashop.webservice.v1',
      } as AdapterInstance);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderProcessorManager',
        platformType: 'prestashop',
      });

      expect(result).toHaveLength(1);
      expect(connectionPort.list).toHaveBeenCalledWith({
        status: 'active',
        platformType: 'prestashop',
      });
    });

    it('should exclude disabled connections', async () => {
      const activeConnection = new Connection(
        'connection-1',
        'prestashop',
        'Active Store',
        'active',
        {},
        'cred_1',
        new Date(),
        new Date(),
      );

      // connectionPort.list is called with { status: 'active' } filter,
      // so it should only return active connections
      connectionPort.list.mockResolvedValue([activeConnection]);

      const metadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderProcessorManager'],
      };

      adapterRegistry.getAdapterMetadata.mockResolvedValue(metadata);
      adapterRegistry.getAdapter.mockResolvedValue({
        adapterKey: 'prestashop.webservice.v1',
      } as AdapterInstance);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderProcessorManager',
      });

      // Only active connection should be returned (disabled ones are filtered by connectionPort.list)
      expect(result).toHaveLength(1);
      expect(result[0].connectionId).toBe('connection-1');
      expect(connectionPort.list).toHaveBeenCalledWith({ status: 'active' });
    });

    it('should skip connections with invalid adapter keys', async () => {
      const validConnection = new Connection(
        'connection-1',
        'prestashop',
        'Valid Store',
        'active',
        {},
        'cred_1',
        new Date(),
        new Date(),
      );

      const invalidConnection = new Connection(
        'connection-2',
        'unknown',
        'Invalid Store',
        'active',
        {},
        'cred_2',
        new Date(),
        new Date(),
      );

      connectionPort.list.mockResolvedValue([validConnection, invalidConnection]);

      const metadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderProcessorManager'],
      };

      adapterRegistry.getAdapterMetadata
        .mockResolvedValueOnce(metadata)
        .mockRejectedValueOnce(
          new AdapterNotFoundException('No default adapterKey found for platformType: unknown'),
        );

      adapterRegistry.getAdapter.mockResolvedValue({
        adapterKey: 'prestashop.webservice.v1',
      } as AdapterInstance);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderProcessorManager',
      });

      // Only valid connection should be returned
      expect(result).toHaveLength(1);
      expect(result[0].connectionId).toBe('connection-1');
    });
  });
});

