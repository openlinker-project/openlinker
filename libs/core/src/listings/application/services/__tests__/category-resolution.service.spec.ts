/**
 * Category Resolution Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CategoryResolutionService } from '../category-resolution.service';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import type { OfferManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';

describe('CategoryResolutionService', () => {
  let service: CategoryResolutionService;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let mappingConfig: jest.Mocked<Pick<IMappingConfigService, 'resolveDestinationCategory'>>;
  let marketplace: { matchCategoryByBarcode: jest.Mock };

  beforeEach(async () => {
    marketplace = {
      matchCategoryByBarcode: jest.fn(),
    };

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
    };

    mappingConfig = {
      resolveDestinationCategory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryResolutionService,
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: MAPPING_CONFIG_SERVICE_TOKEN, useValue: mappingConfig },
      ],
    }).compile();

    service = module.get(CategoryResolutionService);
  });

  it('should resolve via auto_detect when barcode matches a category', async () => {
    marketplace.matchCategoryByBarcode.mockResolvedValue('allegro-cat-123');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      barcode: '5901234123457',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-123',
      provenance: 'borrows',
      method: 'auto_detect',
    });
    expect(marketplace.matchCategoryByBarcode).toHaveBeenCalledWith('5901234123457');
    expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
  });

  it('should fall back to category_mapping when auto-detect returns null', async () => {
    marketplace.matchCategoryByBarcode.mockResolvedValue(null);
    mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-456');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      barcode: '5901234123457',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-456',
      provenance: 'borrows',
      method: 'category_mapping',
    });
    expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith('conn-1', 'ps-cat-1');
  });

  it('should return manual when both auto-detect and mapping fail', async () => {
    marketplace.matchCategoryByBarcode.mockResolvedValue(null);
    mappingConfig.resolveDestinationCategory.mockResolvedValue(null);

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      barcode: '5901234123457',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: null,
      provenance: 'borrows',
      method: 'manual',
    });
  });

  it('should skip auto-detect when no barcode is provided', async () => {
    mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-789');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-789',
      provenance: null,
      method: 'category_mapping',
    });
    expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should try multiple source categories in order until one resolves', async () => {
    mappingConfig.resolveDestinationCategory
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('allegro-cat-deep');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      sourceCategoryIds: ['ps-cat-shallow', 'ps-cat-deep'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-deep',
      provenance: null,
      method: 'category_mapping',
    });
    expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledTimes(2);
    expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith('conn-1', 'ps-cat-shallow');
    expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith('conn-1', 'ps-cat-deep');
  });

  it('should return manual when no barcode and no source categories', async () => {
    const result = await service.resolveCategory({
      connectionId: 'conn-1',
    });

    expect(result).toEqual({
      destinationCategoryId: null,
      provenance: null,
      method: 'manual',
    });
  });

  it('should handle auto-detect error gracefully and fall back to mapping', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('adapter unavailable'));
    mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-fallback');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      barcode: '5901234123457',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-fallback',
      provenance: null,
      method: 'category_mapping',
    });
  });

  it('should handle adapter without matchCategoryByBarcode support', async () => {
    const adapterWithoutMethod = {} as OfferManagerPort;
    integrationsService.getCapabilityAdapter.mockResolvedValue(adapterWithoutMethod);
    mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-mapped');

    const result = await service.resolveCategory({
      connectionId: 'conn-1',
      barcode: '5901234123457',
      sourceCategoryIds: ['ps-cat-1'],
    });

    expect(result).toEqual({
      destinationCategoryId: 'allegro-cat-mapped',
      provenance: 'borrows',
      method: 'category_mapping',
    });
  });
});
