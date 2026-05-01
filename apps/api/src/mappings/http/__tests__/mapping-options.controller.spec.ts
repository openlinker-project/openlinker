/**
 * MappingOptionsController unit tests (#472 / #473 / #474)
 *
 * Covers the resolve→narrow→invoke pipeline for each of the six new
 * capability-scoped routes plus the two categories routes. Verifies:
 *   - happy path: adapter resolved, capability narrowed, list returned
 *   - 501: adapter resolved but doesn't implement the sub-capability
 *   - error propagation when getCapabilityAdapter throws
 *   - categories paths delegate to categoriesCacheService
 *
 * @module apps/api/src/mappings/http/__tests__
 */

import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { IIntegrationsService } from '@openlinker/core/integrations';
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

  const CONNECTION_ID = 'conn-1';

  const fullDestinationAdapter: OrderProcessorManagerPort & DestinationOptionsReader = {
    createOrder: jest.fn(),
    listCarriers: jest.fn().mockResolvedValue([{ value: '1', label: 'Click and collect' }]),
    listOrderStatuses: jest.fn().mockResolvedValue([{ value: '2', label: 'Payment accepted' }]),
    listPaymentMethods: jest.fn().mockResolvedValue([{ value: 'ps_wirepayment', label: 'Wire transfer' }]),
  };

  const fullSourceAdapter: OrderSourcePort & SourceOptionsReader = {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    listOrderStatuses: jest.fn().mockResolvedValue([{ value: 'BOUGHT', label: 'Bought' }]),
    listDeliveryMethods: jest.fn().mockResolvedValue([{ value: 'paczkomat-uuid', label: 'Paczkomat' }]),
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

  beforeEach(async () => {
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;
    categoriesCache = {
      getPrestashopCategories: jest.fn(),
      getAllegroCategories: jest.fn(),
    } as unknown as jest.Mocked<ICategoriesCacheService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MappingOptionsController],
      providers: [
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: CATEGORIES_CACHE_SERVICE_TOKEN, useValue: categoriesCache },
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
    ])('%s resolves OrderProcessorManager and calls %s', async (handlerKey, methodName) => {
      const result = await controller[handlerKey](CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OrderProcessorManager',
      );
      expect(fullDestinationAdapter[methodName]).toHaveBeenCalledTimes(1);
      expect(result).toEqual(await fullDestinationAdapter[methodName]());
    });

    it('throws 501 when the adapter does not implement DestinationOptionsReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(baseDestinationAdapter);

      await expect(controller.getDestinationCarriers(CONNECTION_ID)).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('propagates getCapabilityAdapter rejection (e.g. ConnectionNotFoundException)', async () => {
      const err = new Error('Connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValueOnce(err);

      await expect(controller.getDestinationCarriers(CONNECTION_ID)).rejects.toBe(err);
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
    ])('%s resolves OrderSource and calls %s', async (handlerKey, methodName) => {
      const result = await controller[handlerKey](CONNECTION_ID);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OrderSource',
      );
      expect(fullSourceAdapter[methodName]).toHaveBeenCalledTimes(1);
      expect(result).toEqual(await fullSourceAdapter[methodName]());
    });

    it('throws 501 when the adapter does not implement SourceOptionsReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValueOnce(baseSourceAdapter);

      await expect(controller.getSourceDeliveryMethods(CONNECTION_ID)).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });
  });

  describe('categories', () => {
    it('getDestinationCategories delegates to categoriesCacheService.getPrestashopCategories', async () => {
      const stubCategories = [
        { id: '1', name: 'Cat', parentId: null, depth: 0, active: true },
      ];
      categoriesCache.getPrestashopCategories.mockResolvedValueOnce(stubCategories as never);

      const result = await controller.getDestinationCategories(CONNECTION_ID);

      expect(categoriesCache.getPrestashopCategories).toHaveBeenCalledWith(CONNECTION_ID);
      expect(result).toEqual(stubCategories);
    });

    it('getSourceCategories delegates to categoriesCacheService.getAllegroCategories with parentId', async () => {
      categoriesCache.getAllegroCategories.mockResolvedValueOnce([]);

      await controller.getSourceCategories(CONNECTION_ID, 'parent-42');

      expect(categoriesCache.getAllegroCategories).toHaveBeenCalledWith(CONNECTION_ID, 'parent-42');
    });
  });
});
