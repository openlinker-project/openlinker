/**
 * Shop Attribute Read Service Tests (#1835)
 *
 * Unit tests for adapter resolution, capability gating (`ShopAttributeReader`),
 * attribute-id forwarding, and error propagation.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type {
  ShopAttribute,
  ShopAttributeTerm,
  ShopProductManagerPort,
} from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { ShopAttributeReadService } from '../shop-attribute-read.service';

describe('ShopAttributeReadService', () => {
  let service: ShopAttributeReadService;
  let integrations: jest.Mocked<IIntegrationsService>;

  const connectionId = 'conn-shop-1';
  const attributes: ShopAttribute[] = [
    { id: '6', name: 'Color', slug: 'pa_color' },
    { id: '7', name: 'Size', slug: 'pa_size' },
  ];
  const terms: ShopAttributeTerm[] = [
    { id: '31', name: 'Red', slug: 'red' },
    { id: '32', name: 'Blue', slug: 'blue' },
  ];

  const adapterWith = (
    over: Partial<Record<'listAttributes' | 'listAttributeTerms', jest.Mock>>,
  ): ShopProductManagerPort =>
    ({
      publishProduct: jest.fn(),
      ...over,
    } as unknown as ShopProductManagerPort);

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new ShopAttributeReadService(integrations);
  });

  it('resolves the ProductPublisher adapter and returns its global attributes', async () => {
    const listAttributes = jest.fn().mockResolvedValue(attributes);
    const listAttributeTerms = jest.fn();
    integrations.getCapabilityAdapter.mockResolvedValue(
      adapterWith({ listAttributes, listAttributeTerms }),
    );

    const result = await service.listAttributes(connectionId);

    expect(result).toBe(attributes);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'ProductPublisher');
    expect(listAttributes).toHaveBeenCalledTimes(1);
  });

  it('forwards the attributeId when listing terms', async () => {
    const listAttributes = jest.fn();
    const listAttributeTerms = jest.fn().mockResolvedValue(terms);
    integrations.getCapabilityAdapter.mockResolvedValue(
      adapterWith({ listAttributes, listAttributeTerms }),
    );

    const result = await service.listAttributeTerms(connectionId, '6');

    expect(result).toBe(terms);
    expect(listAttributeTerms).toHaveBeenCalledWith('6');
  });

  it('throws UnprocessableEntityException when the adapter does not implement the reader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith({}));

    await expect(service.listAttributes(connectionId)).rejects.toThrow(UnprocessableEntityException);
    await expect(service.listAttributeTerms(connectionId, '6')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('propagates exceptions from getCapabilityAdapter (connection not found / disabled)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionNotFoundException'));

    await expect(service.listAttributes(connectionId)).rejects.toThrow('ConnectionNotFoundException');
  });
});
