/**
 * Delivery Price List Service Tests (#1530)
 *
 * Unit tests for adapter resolution, capability gating (`DeliveryPriceListReader`),
 * and error propagation.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type { DeliveryPriceList, OfferManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { DeliveryPriceListService } from '../delivery-price-list.service';

describe('DeliveryPriceListService', () => {
  let service: DeliveryPriceListService;
  let integrations: jest.Mocked<IIntegrationsService>;

  const connectionId = 'conn-abc';
  const priceLists: DeliveryPriceList[] = [
    { id: '1', name: '*' },
    { id: '2', name: 'Kurier' },
  ];

  const adapterWith = (listDeliveryPriceLists: jest.Mock | undefined): OfferManagerPort =>
    ({
      ...(listDeliveryPriceLists ? { listDeliveryPriceLists } : {}),
    } as unknown as OfferManagerPort);

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new DeliveryPriceListService(integrations);
  });

  it('returns the delivery price lists from the connection adapter', async () => {
    const listDeliveryPriceLists = jest.fn().mockResolvedValue(priceLists);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(listDeliveryPriceLists));

    const result = await service.listDeliveryPriceLists(connectionId);

    expect(result).toBe(priceLists);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'OfferManager');
    expect(listDeliveryPriceLists).toHaveBeenCalledTimes(1);
  });

  it('throws UnprocessableEntityException when the adapter does not implement listDeliveryPriceLists', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(undefined));

    await expect(service.listDeliveryPriceLists(connectionId)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('propagates exceptions from getCapabilityAdapter (connection not found / disabled)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionNotFoundException'));

    await expect(service.listDeliveryPriceLists(connectionId)).rejects.toThrow(
      'ConnectionNotFoundException',
    );
  });
});
