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
import { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { AdapterRegistryPort } from '../../domain/ports/adapter-registry.port';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '../../domain/ports/credentials-resolver.port';
import { AdapterFactoryResolverService } from '../../infrastructure/adapters/adapter-factory-resolver.service';
import { CONNECTION_PORT_TOKEN, IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { ADAPTER_REGISTRY_TOKEN, ADAPTER_FACTORY_RESOLVER_TOKEN, CREDENTIALS_RESOLVER_TOKEN } from '@openlinker/core/integrations';
import { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import { ConnectionDisabledException } from '@openlinker/core/identifier-mapping';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';
import { CapabilityNotSupportedException } from '../../domain/exceptions/capability-not-supported.exception';
import { AdapterMetadata } from '../../domain/types/adapter.types';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let adapterRegistry: jest.Mocked<AdapterRegistryPort>;
  let factoryResolver: jest.Mocked<AdapterFactoryResolverService>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date(),
    new Date(),
  
    undefined,
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
  );

  const mockAdapterMetadata: AdapterMetadata = {
    adapterKey: 'prestashop.webservice.v1',
    platformType: 'prestashop',
    supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource'],
    displayName: 'PrestaShop WebService v1',
    version: '1.0.0',
  };

  // Stand-in adapter instance for tests that exercise `getCapabilityAdapter`
  // / `listCapabilityAdapters` — the factory resolver returns this shape.
  const mockCapabilityAdapter = { capabilityAdapter: true };

  beforeEach(async () => {
    const mockConnectionPort = {
      get: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    const mockAdapterRegistry = {
      getAdapterMetadata: jest.fn(),
      listAdapters: jest.fn(),
      register: jest.fn(),
      // Default to resolving prestashop's default adapterKey — most tests
      // pass `mockConnection` with `platformType: 'prestashop'` and no
      // explicit adapterKey, hitting this path. Tests that need a different
      // platform override per-test.
      getDefaultAdapterKey: jest.fn().mockResolvedValue('prestashop.webservice.v1'),
    } as unknown as jest.Mocked<AdapterRegistryPort>;

    const mockFactoryResolver = {
      createCapabilityAdapter: jest.fn(),
      registerFactory: jest.fn(),
      getFactory: jest.fn(),
      hasFactory: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<AdapterFactoryResolverService>;

    const mockIdentifierMapping = {
      getExternalIds: jest.fn(),
      getOrCreateInternalId: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      deleteMapping: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingPort>;

    const mockCredentialsResolver = {
      get: jest.fn(),
    } as unknown as jest.Mocked<CredentialsResolverPort>;

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
        {
          provide: ADAPTER_FACTORY_RESOLVER_TOKEN,
          useValue: mockFactoryResolver,
        },
        {
          provide: IDENTIFIER_MAPPING_PORT_TOKEN,
          useValue: mockIdentifierMapping,
        },
        {
          provide: CREDENTIALS_RESOLVER_TOKEN,
          useValue: mockCredentialsResolver,
        },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
    adapterRegistry = module.get(ADAPTER_REGISTRY_TOKEN);
    factoryResolver = module.get(ADAPTER_FACTORY_RESOLVER_TOKEN);
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
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
      );

      connectionPort.get.mockResolvedValue(connectionWithKey);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);

      const result = await service.getAdapter('connection-123');

      expect(result.connection).toEqual(connectionWithKey);
      expect(result.metadata).toEqual(mockAdapterMetadata);
      expect(adapterRegistry.getAdapterMetadata).toHaveBeenCalledWith(
        'prestashop.webservice.v1',
      );
    });

    it('should derive adapterKey from platformType when not provided', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);

      const result = await service.getAdapter('connection-123');

      expect(result.connection).toEqual(mockConnection);
      // Documents the contract: when connection.adapterKey is unset,
      // IntegrationsService asks the registry for the platform default
      // (#571 — replaces the hardcoded deriveAdapterKey map).
      expect(adapterRegistry.getDefaultAdapterKey).toHaveBeenCalledWith('prestashop');
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
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
    it('should return the factory-constructed adapter when capability is supported', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);
      factoryResolver.createCapabilityAdapter.mockResolvedValue(mockCapabilityAdapter);

      const result = await service.getCapabilityAdapter<unknown>(
        'connection-123',
        'ProductMaster',
      );

      expect(result).toEqual(mockCapabilityAdapter);
      expect(factoryResolver.createCapabilityAdapter).toHaveBeenCalledWith(
        'prestashop.webservice.v1',
        mockConnection,
        'ProductMaster',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should propagate AdapterNotFoundException from the factory resolver (#574)', async () => {
      // Pre-#574 this path fell back to a `{ adapterKey } as T` placeholder.
      // After #574 a missing factory throws — fail loud at the dispatch
      // boundary, not at the first method call on an unusable adapter.
      connectionPort.get.mockResolvedValue(mockConnection);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(mockAdapterMetadata);
      factoryResolver.createCapabilityAdapter.mockRejectedValue(
        new AdapterNotFoundException('No factory registered for adapterKey: prestashop.webservice.v1'),
      );

      await expect(
        service.getCapabilityAdapter<unknown>('connection-123', 'ProductMaster'),
      ).rejects.toThrow(AdapterNotFoundException);
    });

    it('should throw CapabilityNotSupportedException when capability not supported', async () => {
      const metadataWithoutCapability: AdapterMetadata = {
        ...mockAdapterMetadata,
        supportedCapabilities: ['InventoryMaster'],
      };

      connectionPort.get.mockResolvedValue(mockConnection);
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );

      // Mock both adapters to support the same capability for testing purposes
      // In reality, they support different capabilities, but this test verifies
      // that multiple adapters supporting the same capability are all returned
      const prestashopMetadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['ProductMaster', 'OrderSource'],
      };

      const allegroMetadata: AdapterMetadata = {
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['ProductMaster', 'OfferManager'],
      };

      connectionPort.list.mockResolvedValue([
        prestashopConnection,
        allegroConnection,
      ]);

      adapterRegistry.getAdapterMetadata
        .mockResolvedValueOnce(prestashopMetadata)
        .mockResolvedValueOnce(allegroMetadata);

      factoryResolver.createCapabilityAdapter
        .mockResolvedValueOnce({ adapterKey: 'prestashop.webservice.v1' })
        .mockResolvedValueOnce({ adapterKey: 'allegro.publicapi.v1' });

      // Use ProductMaster which both adapters support in this test
      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'ProductMaster',
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );

      const prestashopMetadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderSource'],
      };

      connectionPort.list.mockResolvedValue([prestashopConnection]);
      adapterRegistry.getAdapterMetadata.mockResolvedValue(prestashopMetadata);
      factoryResolver.createCapabilityAdapter.mockResolvedValue(mockCapabilityAdapter);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderSource',
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );

      // connectionPort.list is called with { status: 'active' } filter,
      // so it should only return active connections
      connectionPort.list.mockResolvedValue([activeConnection]);

      const metadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderSource'],
      };

      adapterRegistry.getAdapterMetadata.mockResolvedValue(metadata);
      factoryResolver.createCapabilityAdapter.mockResolvedValue(mockCapabilityAdapter);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderSource',
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
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
      
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );

      connectionPort.list.mockResolvedValue([validConnection, invalidConnection]);

      const metadata: AdapterMetadata = {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['OrderSource'],
      };

      adapterRegistry.getAdapterMetadata
        .mockResolvedValueOnce(metadata)
        .mockRejectedValueOnce(
          new AdapterNotFoundException('No default adapterKey found for platformType: unknown'),
        );

      factoryResolver.createCapabilityAdapter.mockResolvedValue(mockCapabilityAdapter);

      const result = await service.listCapabilityAdapters<unknown>({
        capability: 'OrderSource',
      });

      // Only valid connection should be returned
      expect(result).toHaveLength(1);
      expect(result[0].connectionId).toBe('connection-1');
    });
  });
});

