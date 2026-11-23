/**
 * PrestaShop Product Publisher - visibility-only write (#3962)
 *
 * The webservice PUT replaces the whole product, so hiding one is a
 * read-modify-write. These cases pin that only `active` changes: names keep
 * their text in the XML write shape, associations and read-only fields are not
 * sent back, and a product gone shop-side is reported as a stale mapping.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  isShopProductVisibilityWriter,
} from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';

import type { IPrestashopWebserviceClient } from '../../../http/prestashop-webservice.client.interface';
import { PrestashopProductPublisherAdapter } from '../prestashop-product-publisher.adapter';

const connection = {
  id: 'conn-ps-1',
  platformType: 'prestashop',
  name: 'Test PS',
  status: 'active',
  config: { baseUrl: 'https://shop.example', langId: 1 },
  credentialsRef: 'cred-1',
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['ProductPublisher'],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Connection;

/** A product as the JSON read reports it. */
function readProduct(active: string): Record<string, unknown> {
  return {
    id: 100,
    active,
    reference: 'ol_variant_aaaa',
    price: '100.000000',
    id_category_default: '12',
    manufacturer_name: 'Acme',
    quantity: '5',
    position_in_category: '3',
    name: [
      { id: '1', value: 'Widget' },
      { id: '2', value: 'Gadget' },
    ],
    description: [{ id: '1', value: '' }],
    associations: { categories: [{ id: '12' }] },
  };
}

describe('PrestashopProductPublisherAdapter - setShopProductVisibility', () => {
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  let adapter: PrestashopProductPublisherAdapter;

  beforeEach(() => {
    client = {
      getResource: jest.fn(),
      listResources: jest.fn(),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      uploadImage: jest.fn(),
    };
    client.updateResource.mockResolvedValue({ id: '100', active: '0' });
    adapter = new PrestashopProductPublisherAdapter(client, connection);
  });

  it('should be recognised as a ShopProductVisibilityWriter', () => {
    expect(isShopProductVisibilityWriter(adapter)).toBe(true);
  });

  it('should write the product back with only active changed when hiding it', async () => {
    client.getResource.mockResolvedValue(readProduct('1'));

    await adapter.setShopProductVisibility({ externalProductId: '100', visible: false });

    expect(client.getResource).toHaveBeenCalledWith('products', '100');
    expect(client.updateResource).toHaveBeenCalledTimes(1);
    expect(client.updateResource).toHaveBeenCalledWith('products', '100', {
      id: '100',
      active: '0',
      reference: 'ol_variant_aaaa',
      price: '100.000000',
      id_category_default: '12',
      name: {
        language: [
          { '@_id': '1', '#text': 'Widget' },
          { '@_id': '2', '#text': 'Gadget' },
        ],
      },
      description: { language: [{ '@_id': '1', '#text': '' }] },
    });
  });

  it('should set active to 1 when showing the product again', async () => {
    client.getResource.mockResolvedValue(readProduct('0'));

    await adapter.setShopProductVisibility({ externalProductId: '100', visible: true });

    expect(client.updateResource).toHaveBeenCalledWith(
      'products',
      '100',
      expect.objectContaining({ active: '1' }),
    );
  });

  it('should skip the write when the product is already in the requested state', async () => {
    client.getResource.mockResolvedValue(readProduct('0'));

    await adapter.setShopProductVisibility({ externalProductId: '100', visible: false });

    expect(client.updateResource).not.toHaveBeenCalled();
  });

  it('should report a product gone shop-side as a target-not-found error', async () => {
    client.getResource.mockRejectedValue(
      new PrestashopResourceNotFoundException('not found', 'products', '100'),
    );

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
    expect(client.updateResource).not.toHaveBeenCalled();
  });

  it('should report a terminal rejection when the write answers 400', async () => {
    client.getResource.mockResolvedValue(readProduct('1'));
    client.updateResource.mockRejectedValue(new PrestashopApiException('bad field', 400));

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
  });

  it('should propagate a transport failure untouched for the retry path', async () => {
    const failure = new PrestashopApiException('WS down', 503);
    client.getResource.mockRejectedValue(failure);

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBe(failure);
  });
});
