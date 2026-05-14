/**
 * Adapter Factory Resolver Service Unit Tests
 *
 * Focused on the registration surface — `createCapabilityAdapter` is
 * exercised through `IntegrationsService.spec.ts` and the live integration
 * modules at boot. This spec covers the duplicate-fail guard added in
 * #570, which mirrors `AdapterRegistryService.register()`.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AdapterFactoryResolverService } from './adapter-factory-resolver.service';
import type { AdapterFactoryPort } from '../../domain/ports/adapter-factory.port';
import { DuplicateAdapterKeyException } from '../../domain/exceptions/duplicate-adapter-key.exception';

const buildFactoryStub = (): jest.Mocked<AdapterFactoryPort> => ({
  createCapabilityAdapter: jest.fn(),
});

describe('AdapterFactoryResolverService', () => {
  let service: AdapterFactoryResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdapterFactoryResolverService],
    }).compile();

    service = module.get(AdapterFactoryResolverService);
  });

  describe('registerFactory', () => {
    it('registers a factory and exposes it via hasFactory', () => {
      service.registerFactory('prestashop.webservice.v1', buildFactoryStub());

      expect(service.hasFactory('prestashop.webservice.v1')).toBe(true);
    });

    it('throws DuplicateAdapterKeyException when the same adapterKey is registered twice', () => {
      service.registerFactory('prestashop.webservice.v1', buildFactoryStub());

      expect(() => service.registerFactory('prestashop.webservice.v1', buildFactoryStub())).toThrow(
        DuplicateAdapterKeyException
      );
    });

    it('allows different adapterKeys to coexist', () => {
      expect(() => {
        service.registerFactory('prestashop.webservice.v1', buildFactoryStub());
        service.registerFactory('allegro.publicapi.v1', buildFactoryStub());
      }).not.toThrow();
      expect(service.hasFactory('prestashop.webservice.v1')).toBe(true);
      expect(service.hasFactory('allegro.publicapi.v1')).toBe(true);
    });
  });

  describe('hasFactory', () => {
    it('returns false for an unregistered adapterKey', () => {
      expect(service.hasFactory('unknown.adapter.v1')).toBe(false);
    });
  });
});
