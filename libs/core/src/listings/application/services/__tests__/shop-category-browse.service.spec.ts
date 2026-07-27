/**
 * Shop Category Browse Service Tests (#1834)
 *
 * Unit tests for adapter resolution, capability gating (`ShopCategoryBrowser`),
 * parent-id forwarding, and error propagation.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type { ShopCategory, ShopProductManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { ShopCategoryBrowseService } from '../shop-category-browse.service';

describe('ShopCategoryBrowseService', () => {
  let service: ShopCategoryBrowseService;
  let integrations: jest.Mocked<IIntegrationsService>;

  const connectionId = 'conn-shop-1';
  const categories: ShopCategory[] = [
    { id: '10', name: 'Clothing', parentId: null },
    { id: '11', name: 'Shoes', parentId: null },
  ];

  const adapterWith = (browseCategories: jest.Mock | undefined): ShopProductManagerPort =>
    ({
      publishProduct: jest.fn(),
      ...(browseCategories ? { browseCategories } : {}),
    } as unknown as ShopProductManagerPort);

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new ShopCategoryBrowseService(integrations);
  });

  it('resolves the ProductPublisher adapter and returns its browsed categories', async () => {
    const browseCategories = jest.fn().mockResolvedValue(categories);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(browseCategories));

    const result = await service.browseCategories(connectionId);

    expect(result).toBe(categories);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'ProductPublisher');
    expect(browseCategories).toHaveBeenCalledWith(undefined);
  });

  it('forwards the parentId to the adapter for drill-down', async () => {
    const browseCategories = jest.fn().mockResolvedValue([]);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(browseCategories));

    await service.browseCategories(connectionId, '10');

    expect(browseCategories).toHaveBeenCalledWith('10');
  });

  it('throws UnprocessableEntityException when the adapter does not implement browseCategories', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(undefined));

    await expect(service.browseCategories(connectionId)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('propagates exceptions from getCapabilityAdapter (connection not found / disabled)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionNotFoundException'));

    await expect(service.browseCategories(connectionId)).rejects.toThrow(
      'ConnectionNotFoundException',
    );
  });
});
