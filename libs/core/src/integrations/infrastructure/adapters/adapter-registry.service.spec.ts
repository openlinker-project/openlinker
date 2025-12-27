/**
 * Adapter Registry Service Unit Tests
 *
 * Unit tests for AdapterRegistryService, verifying adapter lookup,
 * metadata retrieval, and error handling.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdapterRegistryService } from './adapter-registry.service';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';

describe('AdapterRegistryService', () => {
  let service: AdapterRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdapterRegistryService],
    }).compile();

    service = module.get<AdapterRegistryService>(AdapterRegistryService);
  });

  describe('getAdapterMetadata', () => {
    it('should return metadata for prestashop adapter', async () => {
      const metadata = await service.getAdapterMetadata('prestashop.webservice.v1');

      expect(metadata).toBeDefined();
      expect(metadata.adapterKey).toBe('prestashop.webservice.v1');
      expect(metadata.platformType).toBe('prestashop');
      expect(metadata.supportedCapabilities).toContain('ProductMaster');
      expect(metadata.supportedCapabilities).toContain('InventoryMaster');
      expect(metadata.supportedCapabilities).toContain('OrderProcessorManager');
    });

    it('should return metadata for allegro adapter', async () => {
      const metadata = await service.getAdapterMetadata('allegro.publicapi.v1');

      expect(metadata).toBeDefined();
      expect(metadata.adapterKey).toBe('allegro.publicapi.v1');
      expect(metadata.platformType).toBe('allegro');
      expect(metadata.supportedCapabilities).toContain('Marketplace');
      expect(metadata.supportedCapabilities).toContain('OrderProcessorManager');
    });

    it('should throw AdapterNotFoundException for unknown adapter', async () => {
      await expect(
        service.getAdapterMetadata('unknown.adapter.v1'),
      ).rejects.toThrow(AdapterNotFoundException);
    });
  });

  describe('getAdapter', () => {
    it('should return adapter instance for valid adapter key', async () => {
      const adapter = await service.getAdapter('prestashop.webservice.v1');

      expect(adapter).toBeDefined();
      expect((adapter as any).adapterKey).toBe('prestashop.webservice.v1');
    });

    it('should throw AdapterNotFoundException for unknown adapter', async () => {
      await expect(service.getAdapter('unknown.adapter.v1')).rejects.toThrow(
        AdapterNotFoundException,
      );
    });
  });

  describe('listAdapters', () => {
    it('should return all registered adapters', async () => {
      const adapters = await service.listAdapters();

      expect(adapters).toHaveLength(2);
      expect(adapters.map((a) => a.adapterKey)).toContain(
        'prestashop.webservice.v1',
      );
      expect(adapters.map((a) => a.adapterKey)).toContain('allegro.publicapi.v1');
    });

    it('should return adapters with all required metadata fields', async () => {
      const adapters = await service.listAdapters();

      adapters.forEach((adapter) => {
        expect(adapter).toHaveProperty('adapterKey');
        expect(adapter).toHaveProperty('platformType');
        expect(adapter).toHaveProperty('supportedCapabilities');
        expect(adapter.supportedCapabilities.length).toBeGreaterThan(0);
      });
    });
  });

  describe('capability support', () => {
    it('should verify prestashop supports ProductMaster', async () => {
      const metadata = await service.getAdapterMetadata('prestashop.webservice.v1');
      expect(metadata.supportedCapabilities).toContain('ProductMaster');
    });

    it('should verify allegro supports Marketplace', async () => {
      const metadata = await service.getAdapterMetadata('allegro.publicapi.v1');
      expect(metadata.supportedCapabilities).toContain('Marketplace');
    });

    it('should verify both adapters support OrderProcessorManager', async () => {
      const prestashop = await service.getAdapterMetadata('prestashop.webservice.v1');
      const allegro = await service.getAdapterMetadata('allegro.publicapi.v1');

      expect(prestashop.supportedCapabilities).toContain('OrderProcessorManager');
      expect(allegro.supportedCapabilities).toContain('OrderProcessorManager');
    });
  });
});

