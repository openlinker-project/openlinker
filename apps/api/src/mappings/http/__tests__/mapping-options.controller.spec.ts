/**
 * MappingOptionsController unit tests (#472 / #473 / #474 / #479)
 *
 * Covers the resolve→narrow→invoke pipeline for each of the six new
 * capability-scoped routes plus the two categories routes. Verifies:
 *   - happy path: adapter resolved, capability narrowed, list returned
 *   - 501: adapter resolved but doesn't implement the sub-capability
 *   - error propagation when getCapabilityAdapter throws
 *   - categories paths delegate to categoriesCacheService
 *   - #479 partner resolution: URL-is-Allegro / URL-is-PS / no pairing /
 *     ambiguous pairing / unsupported platform branches
 *
 * @module apps/api/src/mappings/http/__tests__
 */

import { BadRequestException, NotImplementedException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import type {
  DestinationOptionsReader,
  OrderProcessorManagerPort,
  OrderSourcePort,
  SourceOptionsReader,
} from '@openlinker/core/orders';

import { CATEGORIES_CACHE_SERVICE_TOKEN } from '../../../categories/categories.tokens';
import type { ICategoriesCacheService } from '../../../categories/categories-cache.service.interface';
import { MappingOptionsController } from '../mapping-options.controller';

describe('MappingOptionsController', () => {
  let controller: MappingOptionsController;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let categoriesCache: jest.Mocked<ICategoriesCacheService>;
  let connectionPort: jest.Mocked<ConnectionPort>;

  const ALLEGRO_CONNECTION_ID = 'conn-allegro-1';
  const PRESTASHOP_CONNECTION_ID = 'conn-ps-1';

  const fullDestinationAdapter: OrderProcessorManagerPort & DestinationOptionsReader = {
    createOrder: jest.fn(),
    listCarriers: jest.fn().mockResolvedValue([{ value: '1', label: 'Click and collect' }]),
    listOrderStatuses: jest.fn().mockResolvedValue([{ value: '2', label: 'Payment accepted' }]),
    listPaymentMethods: jest
      .fn()
      .mockResolvedValue([{ value: 'ps_wirepayment', label: 'Wire transfer' }]),
  };

  const fullSourceAdapter: OrderSourcePort & SourceOptionsReader = {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    listOrderStatuses: jest.fn().mockResolvedValue([{ value: 'BOUGHT', label: 'Bought' }]),
    listDeliveryMethods: jest
      .fn()
      .mockResolvedValue([{ value: 'paczkomat-uuid', label: 'Paczkomat' }]),
    listPaymentMethods: jest.fn().mockResolvedValue([{ value: 'ONLINE', label: 'Online' }]),
  };

  /** Adapter that implements the base port but not the sub-capability — triggers 501. */
  const baseDestinationAdapter: OrderProcessorManagerPort = {
    createOrder: jest.fn(),
  };
  const baseSourceAdapter: OrderSourcePort = {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
  };

  /** Build a Connection fixture with sensible defaults for tests. */
  function makeConnection(
    overrides: Partial<Connection> & Pick<Connection, 'id' | 'platformType'>
  ): Connection {
    return {
      id: overrides.id,
      platformType: overrides.platformType,
      name: overrides.name ?? `Connection ${overrides.id}`,
      status: overrides.status ?? 'active',
      config: overrides.config ?? {},
      credentialsRef: overrides.credentialsRef ?? '',
      createdAt: overrides.createdAt ?? new Date('2026-01-01'),
      updatedAt: overrides.updatedAt ?? new Date('2026-01-01'),
      adapterKey: overrides.adapterKey ?? undefined,
      enabledCapabilities: overrides.enabledCapabilities ?? [],
    } as Connection;
  }

  const allegroConnection = makeConnection({
    id: ALLEGRO_CONNECTION_ID,
    platformType: 'allegro',
    config: { masterCatalogConnectionId: PRESTASHOP_CONNECTION_ID },
  });
  const prestashopConnection = makeConnection({
    id: PRESTASHOP_CONNECTION_ID,
    platformType: 'prestashop',
  });

  beforeEach(async () => {
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;
    categoriesCache = {
      getPrestashopCategories: jest.fn(),
      getAllegroCategories: jest.fn(),
      getAllegroCategoryPath: jest.fn(),
    } as unknown as jest.Mocked<ICategoriesCacheService>;
    connectionPort = {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    // Default: existing happy-path tests use ALLEGRO_CONNECTION_ID and expect
    // it to resolve to itself for source / to PRESTASHOP_CONNECTION_ID for
    // destination. Per-test branches override `get` / `list` as needed.
    connectionPort.get.mockResolvedValue(allegroConnection);
    connectionPort.list.mockResolvedValue([allegroConnection]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MappingOptionsController],
      providers: [
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: CATEGORIES_CACHE_SERVICE_TOKEN, useValue: categoriesCache },
        { provide: CONNECTION_PORT_TOKEN, useValue: connectionPort },
      ],
    }).compile();

    controller = module.get(MappingOptionsController);
  });

  describe('destination side', () => {
    beforeEach(() => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(fullDestinationAdapter);
    });

    it.each([
      ['getDestinationCarriers' as const, 'listCarriers' as const],
      ['getDestinationOrderStatuses' as const, 'listOrderStatuses' as const],
      ['getDestinationPaymentMethods' as const, 'listPaymentMethods' as const],
    ])(
      '%s resolves OrderProcessorManager from the paired PrestaShop and calls %s',
      async (handlerKey, methodName) => {
        const result = await controller[handlerKey](ALLEGRO_CONNECTION_ID);

        // Resolved partner = paired PS connection (URL is Allegro, side = destination).
        expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
          PRESTASHOP_CONNECTION_ID,
          'OrderProcessorManager'
        );
        expect(fullDestinationAdapter[methodName]).toHaveBeenCalledTimes(1);
        expect(result).toEqual(await fullDestinationAdapter[methodName]());
      }
    );

    it('throws 501 when the adapter does not implement DestinationOptionsReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(baseDestinationAdapter);

      await expect(controller.getDestinationCarriers(ALLEGRO_CONNECTION_ID)).rejects.toBeInstanceOf(
        NotImplementedException
      );
    });

    it('propagates getCapabilityAdapter rejection (e.g. ConnectionNotFoundException)', async () => {
      const err = new Error('Connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValueOnce(err);

      await expect(controller.getDestinationCarriers(ALLEGRO_CONNECTION_ID)).rejects.toBe(err);
    });
  });

  describe('source side', () => {
    beforeEach(() => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(fullSourceAdapter);
    });

    it.each([
      ['getSourceOrderStatuses' as const, 'listOrderStatuses' as const],
      ['getSourceDeliveryMethods' as const, 'listDeliveryMethods' as const],
      ['getSourcePaymentMethods' as const, 'listPaymentMethods' as const],
    ])(
      '%s resolves OrderSource from the URL Allegro connection and calls %s',
      async (handlerKey, methodName) => {
        const result = await controller[handlerKey](ALLEGRO_CONNECTION_ID);

        // Resolved partner = URL connection itself (URL is Allegro, side = source).
        expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
          ALLEGRO_CONNECTION_ID,
          'OrderSource'
        );
        expect(fullSourceAdapter[methodName]).toHaveBeenCalledTimes(1);
        expect(result).toEqual(await fullSourceAdapter[methodName]());
      }
    );

    it('throws 501 when the adapter does not implement SourceOptionsReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(baseSourceAdapter);

      await expect(
        controller.getSourceDeliveryMethods(ALLEGRO_CONNECTION_ID)
      ).rejects.toBeInstanceOf(NotImplementedException);
    });
  });

  describe('partner resolution (#479)', () => {
    it('URL is PrestaShop, side=destination → resolves to URL connection', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullDestinationAdapter);

      await controller.getDestinationCarriers(PRESTASHOP_CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        PRESTASHOP_CONNECTION_ID,
        'OrderProcessorManager'
      );
    });

    it('URL is PrestaShop, side=source → reverse-resolves the paired Allegro', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([allegroConnection]);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullSourceAdapter);

      await controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);

      // Reverse lookup filters Allegro connections to active ones.
      expect(connectionPort.list).toHaveBeenCalledWith({
        platformType: 'allegro',
        status: 'active',
      });
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        ALLEGRO_CONNECTION_ID,
        'OrderSource'
      );
    });

    it('URL is Allegro with no masterCatalogConnectionId → 400 with operator message', async () => {
      const orphanedAllegro = makeConnection({
        id: 'orphan-allegro',
        platformType: 'allegro',
        config: {},
      });
      connectionPort.get.mockResolvedValueOnce(orphanedAllegro);

      const promise = controller.getDestinationCarriers('orphan-allegro');
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/no destination paired/);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('URL is PrestaShop with zero paired Allegro connections → 400 with operator message', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      // No Allegro connection points at this PS.
      connectionPort.list.mockResolvedValueOnce([]);

      const promise = controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/no source paired/);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('URL is PrestaShop with multiple paired Allegro connections → 400 listing the conflicting ids', async () => {
      const allegroA = makeConnection({
        id: 'allegro-a',
        platformType: 'allegro',
        config: { masterCatalogConnectionId: PRESTASHOP_CONNECTION_ID },
      });
      const allegroB = makeConnection({
        id: 'allegro-b',
        platformType: 'allegro',
        config: { masterCatalogConnectionId: PRESTASHOP_CONNECTION_ID },
      });
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([allegroA, allegroB]);

      const promise = controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        /multiple paired Allegro connections \(allegro-a, allegro-b\)/
      );
    });

    it('URL connection has unsupported platform → 400', async () => {
      const shopify = makeConnection({ id: 'shopify-1', platformType: 'shopify' });
      connectionPort.get.mockResolvedValueOnce(shopify);

      const promise = controller.getDestinationCarriers('shopify-1');
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/unsupported platform/);
    });

    it('URL is PrestaShop, side=source: ignores Allegro connections paired to other PS instances', async () => {
      const otherPaired = makeConnection({
        id: 'allegro-other',
        platformType: 'allegro',
        config: { masterCatalogConnectionId: 'some-other-ps' },
      });
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([otherPaired]);

      // Same as zero-paired branch: 400 because no Allegro points at *this* PS.
      await expect(
        controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID)
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('categories', () => {
    it('getDestinationCategories delegates to categoriesCacheService.getPrestashopCategories', async () => {
      const stubCategories = [{ id: '1', name: 'Cat', parentId: null, depth: 0, active: true }];
      categoriesCache.getPrestashopCategories.mockResolvedValueOnce(stubCategories as never);

      const result = await controller.getDestinationCategories(ALLEGRO_CONNECTION_ID);

      expect(categoriesCache.getPrestashopCategories).toHaveBeenCalledWith(ALLEGRO_CONNECTION_ID);
      expect(result).toEqual(stubCategories);
    });

    it('getSourceCategories delegates to categoriesCacheService.getAllegroCategories with parentId', async () => {
      categoriesCache.getAllegroCategories.mockResolvedValueOnce([]);

      await controller.getSourceCategories(ALLEGRO_CONNECTION_ID, 'parent-42');

      expect(categoriesCache.getAllegroCategories).toHaveBeenCalledWith(
        ALLEGRO_CONNECTION_ID,
        'parent-42'
      );
    });

    it('getSourceCategoryPath delegates to categoriesCacheService.getAllegroCategoryPath and maps nodes', async () => {
      categoriesCache.getAllegroCategoryPath.mockResolvedValueOnce([
        { id: '1', name: 'Electronics' },
        { id: '10', name: 'Phones' },
      ]);

      const result = await controller.getSourceCategoryPath(ALLEGRO_CONNECTION_ID, '10');

      expect(categoriesCache.getAllegroCategoryPath).toHaveBeenCalledWith(ALLEGRO_CONNECTION_ID, '10');
      expect(result).toEqual([
        { id: '1', name: 'Electronics' },
        { id: '10', name: 'Phones' },
      ]);
    });
  });
});
