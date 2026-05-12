/**
 * Adapter Registry Service Unit Tests
 *
 * Verifies the empty-registry-with-register flow added in #570/#571.
 * Each test constructs a fresh service (zero pre-registered adapters)
 * and exercises the public port surface — no test depends on the previous
 * inline literal that was deleted with the modularity audit.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdapterRegistryService } from './adapter-registry.service';
import { AdapterMetadata } from '../../domain/types/adapter.types';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';
import { DuplicateAdapterKeyException } from '../../domain/exceptions/duplicate-adapter-key.exception';
import { DuplicatePlatformDefaultException } from '../../domain/exceptions/duplicate-platform-default.exception';

const prestashopMetadata: AdapterMetadata = {
  adapterKey: 'prestashop.webservice.v1',
  platformType: 'prestashop',
  supportedCapabilities: [
    'ProductMaster',
    'InventoryMaster',
    'OrderSource',
    'OrderProcessorManager',
  ],
  displayName: 'PrestaShop WebService v1',
  version: '1.0.0',
  isDefault: true,
};

const allegroMetadata: AdapterMetadata = {
  adapterKey: 'allegro.publicapi.v1',
  platformType: 'allegro',
  supportedCapabilities: ['OrderSource', 'OfferManager'],
  displayName: 'Allegro Public API v1',
  version: '1.0.0',
  isDefault: true,
};

describe('AdapterRegistryService', () => {
  let service: AdapterRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdapterRegistryService],
    }).compile();

    service = module.get<AdapterRegistryService>(AdapterRegistryService);
  });

  describe('register', () => {
    it('persists metadata and returns it via getAdapterMetadata', async () => {
      service.register(prestashopMetadata);

      const fetched = await service.getAdapterMetadata('prestashop.webservice.v1');
      expect(fetched).toEqual(prestashopMetadata);
    });

    it('throws DuplicateAdapterKeyException when the same adapterKey is registered twice', () => {
      service.register(prestashopMetadata);

      expect(() => service.register(prestashopMetadata)).toThrow(DuplicateAdapterKeyException);
    });

    it('throws DuplicatePlatformDefaultException when two adapters claim the same platform default', () => {
      service.register(prestashopMetadata);

      const conflicting: AdapterMetadata = {
        ...prestashopMetadata,
        adapterKey: 'prestashop.alternative.v1',
        isDefault: true,
      };

      expect(() => service.register(conflicting)).toThrow(DuplicatePlatformDefaultException);
    });

    it('allows multiple adapters per platformType when only one is the default', () => {
      service.register(prestashopMetadata);
      // Same platform, different adapterKey, isDefault omitted — no conflict.
      const altPrestashop: AdapterMetadata = {
        ...prestashopMetadata,
        adapterKey: 'prestashop.alternative.v1',
        isDefault: false,
      };
      expect(() => service.register(altPrestashop)).not.toThrow();
    });
  });

  describe('getDefaultAdapterKey', () => {
    it('returns the adapterKey registered with isDefault: true', async () => {
      service.register(prestashopMetadata);
      service.register(allegroMetadata);

      expect(await service.getDefaultAdapterKey('prestashop')).toBe('prestashop.webservice.v1');
      expect(await service.getDefaultAdapterKey('allegro')).toBe('allegro.publicapi.v1');
    });

    it('throws AdapterNotFoundException for an unknown platformType', async () => {
      service.register(prestashopMetadata);

      await expect(service.getDefaultAdapterKey('shopify')).rejects.toThrow(
        AdapterNotFoundException,
      );
    });

    it('does not register a default when isDefault is omitted or false', async () => {
      service.register({ ...prestashopMetadata, isDefault: false });

      await expect(service.getDefaultAdapterKey('prestashop')).rejects.toThrow(
        AdapterNotFoundException,
      );
    });
  });

  describe('getAdapter', () => {
    it('returns adapter placeholder for a registered adapterKey', async () => {
      service.register(prestashopMetadata);

      const adapter = await service.getAdapter('prestashop.webservice.v1');

      expect(adapter).toBeDefined();
      expect((adapter as { adapterKey: string }).adapterKey).toBe('prestashop.webservice.v1');
    });

    it('throws AdapterNotFoundException for an unknown adapterKey', async () => {
      await expect(service.getAdapter('unknown.adapter.v1')).rejects.toThrow(
        AdapterNotFoundException,
      );
    });
  });

  describe('listAdapters', () => {
    it('returns an empty array when no adapters are registered', async () => {
      const adapters = await service.listAdapters();

      expect(adapters).toEqual([]);
    });

    it('returns every registered adapter, in registration order', async () => {
      service.register(prestashopMetadata);
      service.register(allegroMetadata);

      const adapters = await service.listAdapters();

      expect(adapters).toHaveLength(2);
      expect(adapters.map((a) => a.adapterKey)).toEqual([
        'prestashop.webservice.v1',
        'allegro.publicapi.v1',
      ]);
    });
  });
});
