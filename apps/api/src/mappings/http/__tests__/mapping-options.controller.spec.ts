/**
 * MappingOptionsController unit tests (#472 / #473 / #474 / #479)
 *
 * Covers the resolve→narrow→invoke pipeline for each of the six new
 * capability-scoped routes plus the two categories routes. Verifies:
 *   - happy path: adapter resolved, capability narrowed, list returned
 *   - 501: adapter resolved but doesn't implement the sub-capability
 *   - error propagation when getCapabilityAdapter throws
 *   - categories paths delegate to categoriesCacheService
 *   - #479/#1738 partner resolution: pairing-first + capability-checked (no
 *     platform literals) — source-URL / master-URL / no pairing / ambiguous
 *     multi-source / capability-missing branches, including Erli as a source
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
  const ERLI_CONNECTION_ID = 'conn-erli-1';

  /**
   * Advertised capabilities per connection id, served through the
   * metadata-only `getAdapter` the #1738 resolution probes. Tests may extend
   * or override entries per case.
   */
  let capabilitiesById: Record<string, string[]>;

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
  const erliConnection = makeConnection({
    id: ERLI_CONNECTION_ID,
    platformType: 'erli',
    config: { masterCatalogConnectionId: PRESTASHOP_CONNECTION_ID },
  });

  beforeEach(async () => {
    capabilitiesById = {
      [ALLEGRO_CONNECTION_ID]: ['OrderSource', 'OfferManager'],
      [ERLI_CONNECTION_ID]: ['OrderSource', 'OfferManager'],
      [PRESTASHOP_CONNECTION_ID]: ['ProductMaster', 'OrderProcessorManager', 'OrderSource'],
    };
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
      // Metadata-only capability probe (#1738): unknown ids reject, mirroring
      // ConnectionNotFoundException from the real service.
      getAdapter: jest.fn((id: string) => {
        const capabilities = capabilitiesById[id];
        if (!capabilities) {
          return Promise.reject(new Error(`Connection not found: ${id}`));
        }
        return Promise.resolve({
          connection: makeConnection({ id, platformType: 'test' }),
          metadata: {
            adapterKey: 'test.v1',
            platformType: 'test',
            supportedCapabilities: capabilities,
            displayName: 'Test',
            version: '1.0.0',
          },
        });
      }),
    } as unknown as jest.Mocked<IIntegrationsService>;
    categoriesCache = {
      getPrestashopCategories: jest.fn(),
      getAllegroCategories: jest.fn(),
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

  describe('partner resolution (#479 / #1738)', () => {
    it('URL is PrestaShop (unpaired master), side=destination → resolves to URL connection', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullDestinationAdapter);

      await controller.getDestinationCarriers(PRESTASHOP_CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        PRESTASHOP_CONNECTION_ID,
        'OrderProcessorManager'
      );
    });

    it('URL is PrestaShop, side=source → reverse-resolves the single paired OrderSource connection', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([allegroConnection]);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullSourceAdapter);

      await controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);

      // Reverse lookup is capability-driven, not platform-filtered (#1738).
      expect(connectionPort.list).toHaveBeenCalledWith({ status: 'active' });
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        ALLEGRO_CONNECTION_ID,
        'OrderSource'
      );
    });

    it('URL is Erli (paired source), side=source → resolves to the URL connection itself', async () => {
      connectionPort.get.mockResolvedValueOnce(erliConnection);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullSourceAdapter);

      await controller.getSourceDeliveryMethods(ERLI_CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        ERLI_CONNECTION_ID,
        'OrderSource'
      );
    });

    it('URL is Erli (paired source), side=destination → resolves to the paired master', async () => {
      connectionPort.get.mockResolvedValueOnce(erliConnection);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullDestinationAdapter);

      await controller.getDestinationCarriers(ERLI_CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        PRESTASHOP_CONNECTION_ID,
        'OrderProcessorManager'
      );
    });

    it('URL is a paired connection without OrderSource, side=source → 400 capability message', async () => {
      capabilitiesById[ERLI_CONNECTION_ID] = ['OfferManager'];
      connectionPort.get.mockResolvedValueOnce(erliConnection);

      const promise = controller.getSourceDeliveryMethods(ERLI_CONNECTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/does not support OrderSource/);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('URL is an unpaired connection without OrderProcessorManager, side=destination → 400 capability message', async () => {
      const orphanedAllegro = makeConnection({
        id: 'orphan-allegro',
        platformType: 'allegro',
        config: {},
      });
      capabilitiesById['orphan-allegro'] = ['OrderSource', 'OfferManager'];
      connectionPort.get.mockResolvedValueOnce(orphanedAllegro);

      const promise = controller.getDestinationCarriers('orphan-allegro');
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/does not support OrderProcessorManager/);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('URL is PrestaShop with zero paired source connections → 400 with operator message', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      // Nothing points at this PS.
      connectionPort.list.mockResolvedValueOnce([]);

      const promise = controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(/no source paired/);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('URL is PrestaShop with multiple paired OrderSource connections → 400 listing the conflicting ids', async () => {
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([allegroConnection, erliConnection]);

      const promise = controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        new RegExp(
          `multiple paired source connections \\(${ALLEGRO_CONNECTION_ID}, ${ERLI_CONNECTION_ID}\\)`
        )
      );
    });

    it('URL is PrestaShop, side=source: a paired non-OrderSource connection is not counted', async () => {
      const pairedCarrier = makeConnection({
        id: 'conn-inpost-1',
        platformType: 'inpost',
        config: { masterCatalogConnectionId: PRESTASHOP_CONNECTION_ID },
      });
      capabilitiesById['conn-inpost-1'] = ['ShippingProviderManager'];
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([pairedCarrier, allegroConnection]);
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(fullSourceAdapter);

      await controller.getSourceOrderStatuses(PRESTASHOP_CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        ALLEGRO_CONNECTION_ID,
        'OrderSource'
      );
    });

    it('URL is PrestaShop, side=source: ignores connections paired to other masters', async () => {
      const otherPaired = makeConnection({
        id: 'allegro-other',
        platformType: 'allegro',
        config: { masterCatalogConnectionId: 'some-other-ps' },
      });
      capabilitiesById['allegro-other'] = ['OrderSource'];
      connectionPort.get.mockResolvedValueOnce(prestashopConnection);
      connectionPort.list.mockResolvedValueOnce([otherPaired]);

      // Same as zero-paired branch: 400 because nothing points at *this* PS.
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
  });
});
