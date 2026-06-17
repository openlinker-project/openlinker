/**
 * Category Resolution Service — unit tests
 *
 * Covers the provenance-aware single-resolve chain (provision → barcode →
 * mapping → manual), provenance derivation from destination capabilities, and
 * the #795 batch path (`resolveCategoriesBatch`): delegation to the
 * `EanCategoryMatcher` sub-capability when supported, and graceful degradation
 * to `no-match` when the resolved adapter cannot batch-resolve EANs (a
 * `borrows`-taxonomy destination, e.g. Erli per ADR-025 §3).
 *
 * @module libs/core/src/listings/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import {
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
    it('should resolve via auto_detect when the adapter matches the barcode (borrows provenance)', async () => {
      // Adapter matches barcodes but ships no own category tree → borrows.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-1',
        provenance: 'borrows',
        method: 'auto_detect',
      });
    });

    it('should report owns provenance when the adapter browses its own category tree', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategories: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-1',
        provenance: 'owns',
        method: 'auto_detect',
      });
    });

    it('should report owns provenance when the adapter exposes per-category parameters', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategoryParameters: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result.provenance).toBe('owns');
    });

    it('should fall back to category_mapping when auto_detect misses (carrying barcode-path provenance)', async () => {
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

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-mapped',
        provenance: 'borrows',
        method: 'category_mapping',
      });
    });

    it('should leave provenance null on the mapping path when no barcode is supplied', async () => {
      mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-mapped');

      const result = await service.resolveCategory({
        connectionId: CONNECTION_ID,
        sourceCategoryIds: ['src-1'],
      });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-mapped',
        provenance: null,
        method: 'category_mapping',
      });
      // Laziness preserved — no adapter resolution without a barcode.
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should return manual with null id when nothing resolves', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue(null),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: null,
        provenance: 'borrows',
        method: 'manual',
      });
    });

    it('should treat the provision step as a no-op until CategoryProvisioner ships (#1041)', async () => {
      // Even a fully-capable adapter never yields method=provision today.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategories: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result.method).toBe('auto_detect');
      expect(result.method).not.toBe('provision');
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

    it('should degrade to no-match for every variant when the adapter cannot batch-resolve', async () => {
      // An adapter that `borrows` its taxonomy (no EanCategoryMatcher, e.g. Erli
      // per ADR-025 §3) must not abort the batch — every variant degrades to
      // `no-match` so the operator can supply the category per row in Review.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        // no resolveCategoriesForBatchByEan → not an EanCategoryMatcher
      });

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, input);

      expect(result.get('v1')).toEqual({ kind: 'no-match' });
      expect(result.get('v2')).toEqual({ kind: 'no-match' });
      expect(result.size).toBe(2);
    });

    it('should propagate connection-resolution errors from getCapabilityAdapter', async () => {
      const boom = new Error('connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValue(boom);

      await expect(service.resolveCategoriesBatch(CONNECTION_ID, input)).rejects.toBe(boom);
    });
  });
});
