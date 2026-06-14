/**
 * Category Resolution Service — unit tests
 *
 * Covers the 3-step single-resolve chain and the #795 batch path
 * (`resolveCategoriesBatch`): delegation to the `EanCategoryMatcher`
 * sub-capability when supported, and the `AdapterCapabilityNotSupportedException`
 * branch when the resolved adapter cannot batch-resolve EANs.
 *
 * @module libs/core/src/listings/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import {
  AdapterCapabilityNotSupportedException,
  type BatchCategoryByEanInput,
  type EanMatchResult,
} from '@openlinker/core/listings';

import { CategoryResolutionService } from './category-resolution.service';

const CONNECTION_ID = 'conn-123';

describe('CategoryResolutionService', () => {
  let integrationsService: { getCapabilityAdapter: jest.Mock };
  let mappingConfig: { resolveDestinationCategory: jest.Mock };
  let service: CategoryResolutionService;

  beforeEach(() => {
    integrationsService = { getCapabilityAdapter: jest.fn() };
    mappingConfig = { resolveDestinationCategory: jest.fn() };
    service = new CategoryResolutionService(
      integrationsService as unknown as IIntegrationsService,
      mappingConfig as unknown as IMappingConfigService
    );
  });

  describe('resolveCategory', () => {
    it('should resolve via auto_detect when the adapter matches the barcode', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({ allegroCategoryId: 'allegro-cat-1', method: 'auto_detect' });
    });

    it('should fall back to category_mapping when auto_detect misses', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue(null),
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-mapped');

      const result = await service.resolveCategory({
        connectionId: CONNECTION_ID,
        barcode: '590',
        sourceCategoryIds: ['src-1'],
      });

      expect(result).toEqual({ allegroCategoryId: 'allegro-cat-mapped', method: 'category_mapping' });
    });

    it('should return manual with null id when nothing resolves', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue(null),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({ allegroCategoryId: null, method: 'manual' });
    });
  });

  describe('resolveCategoriesBatch', () => {
    const input: BatchCategoryByEanInput = {
      items: [
        { variantId: 'v1', ean: '590111' },
        { variantId: 'v2', ean: null },
      ],
    };

    it('should delegate to the adapter when it implements EanCategoryMatcher', async () => {
      const adapterResult = new Map<string, EanMatchResult>([
        ['v1', { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' }],
        ['v2', { kind: 'no-ean' }],
      ]);
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(adapterResult);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, input);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      expect(resolveCategoriesForBatchByEan).toHaveBeenCalledWith(input);
      expect(result).toBe(adapterResult);
    });

    it('should throw AdapterCapabilityNotSupportedException when the adapter cannot batch-resolve', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        // no resolveCategoriesForBatchByEan → not an EanCategoryMatcher
      });

      await expect(service.resolveCategoriesBatch(CONNECTION_ID, input)).rejects.toBeInstanceOf(
        AdapterCapabilityNotSupportedException
      );
    });

    it('should propagate connection-resolution errors from getCapabilityAdapter', async () => {
      const boom = new Error('connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValue(boom);

      await expect(service.resolveCategoriesBatch(CONNECTION_ID, input)).rejects.toBe(boom);
    });
  });
});
