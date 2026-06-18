/**
 * PrestaShop Product Publisher Adapter — unit spec
 *
 * Covers `publishProduct` (create vs upsert, status mapping, multi-category,
 * platformParams passthrough, 4xx → rejection, 5xx propagation, 401 propagation)
 * and `provisionCategory` (find-vs-create, hierarchical parent threading, mixed
 * found/created path). WebService client is mocked.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  type PublishProductCommand,
} from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { PrestashopApiException, PrestashopAuthenticationException } from '@openlinker/integrations-prestashop';

import type { IPrestashopWebserviceClient } from '../../../http/prestashop-webservice.client.interface';
import { PrestashopProductPublisherAdapter } from '../prestashop-product-publisher.adapter';

const CONNECTION_ID = 'conn-ps-1';

function makeClient(): jest.Mocked<IPrestashopWebserviceClient> {
  return {
    getResource: jest.fn(),
    listResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
    deleteResource: jest.fn(),
  };
}

const connection: Connection = {
  id: CONNECTION_ID,
  platformType: 'prestashop',
  name: 'Test PS',
  status: 'active',
  config: { baseUrl: 'https://shop.example', langId: 1 } as Record<string, unknown>,
  credentialsRef: 'cred-1',
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Connection;

function baseCommand(overrides: Partial<PublishProductCommand> = {}): PublishProductCommand {
  return {
    internalVariantId: 'ol_variant_aaaa',
    connectionId: CONNECTION_ID,
    destinationCategoryIds: ['12'],
    price: { amount: 19.99, currency: 'PLN' },
    stock: 5,
    status: 'published',
    content: { title: 'Widget', description: 'A widget' },
    ...overrides,
  };
}

/** Wire up default stock_availables mock so publishProduct tests don't fail on stock update. */
function withDefaultStockMock(client: jest.Mocked<IPrestashopWebserviceClient>): void {
  client.listResources.mockImplementation((resource) => {
    if (resource === 'stock_availables') {
      return Promise.resolve([{ id: '1', id_product: '100', quantity: '0' }]);
    }
    return Promise.resolve([]);
  });
  client.updateResource.mockResolvedValue({ id: '1' });
}

describe('PrestashopProductPublisherAdapter', () => {
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  let adapter: PrestashopProductPublisherAdapter;

  beforeEach(() => {
    client = makeClient();
    adapter = new PrestashopProductPublisherAdapter(client, connection);
  });

  describe('publishProduct', () => {
    it('should POST a new product and return externalProductId', async () => {
      client.createResource.mockResolvedValue({ id: '100', active: '1' });
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(baseCommand());

      expect(client.createResource).toHaveBeenCalledTimes(1);
      const [resource, body] = client.createResource.mock.calls[0];
      expect(resource).toBe('products');
      expect(body).toMatchObject({
        price: '19.99',
        active: '1',
        id_category_default: '12',
      });
      expect(result).toEqual({ externalProductId: '100', status: 'published' });
    });

    it('should PUT to existing id when externalProductId is set (upsert)', async () => {
      client.updateResource
        .mockResolvedValueOnce({ id: '100', active: '0' }) // product update
        .mockResolvedValueOnce({ id: '1' }); // stock update
      client.listResources.mockResolvedValue([{ id: '1', id_product: '100', quantity: '0' }]);

      const result = await adapter.publishProduct(
        baseCommand({ externalProductId: '100', status: 'draft' }),
      );

      expect(client.createResource).not.toHaveBeenCalled();
      expect(client.updateResource).toHaveBeenNthCalledWith(
        1,
        'products',
        '100',
        expect.objectContaining({ id: '100', active: '0' }),
      );
      expect(result).toEqual({ externalProductId: '100', status: 'draft' });
    });

    it('should map status "published" → active "1"', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(baseCommand({ status: 'published' }));

      const body = client.createResource.mock.calls[0][1];
      expect(body.active).toBe('1');
    });

    it('should map status "draft" → active "0"', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '0' });
      withDefaultStockMock(client);

      await adapter.publishProduct(baseCommand({ status: 'draft' }));

      const body = client.createResource.mock.calls[0][1];
      expect(body.active).toBe('0');
    });

    it('should assign multi-category via associations and set id_category_default to first', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(
        baseCommand({ destinationCategoryIds: ['10', '11'] }),
      );

      const body = client.createResource.mock.calls[0][1];
      expect(body.id_category_default).toBe('10');
      expect((body.associations as Record<string, unknown>)?.categories).toEqual({
        category: [{ id: '10' }, { id: '11' }],
      });
    });

    it('should pass platformParams through without overriding mapped fields', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(
        baseCommand({ platformParams: { active: '0', id_manufacturer: '5' } }),
      );

      const body = client.createResource.mock.calls[0][1];
      // Explicit mapped `active` wins over platformParams
      expect(body.active).toBe('1');
      // Un-modeled knob passes through
      expect(body.id_manufacturer).toBe('5');
    });

    it('should update stock after product creation', async () => {
      client.createResource.mockResolvedValue({ id: '42', active: '1' });
      client.listResources.mockResolvedValue([{ id: '7', id_product: '42', quantity: '0' }]);
      client.updateResource.mockResolvedValue({ id: '7' });

      await adapter.publishProduct(baseCommand({ stock: 10 }));

      expect(client.listResources).toHaveBeenCalledWith(
        'stock_availables',
        expect.objectContaining({ custom: { 'filter[id_product]': '42' } }),
      );
      expect(client.updateResource).toHaveBeenCalledWith(
        'stock_availables',
        '7',
        expect.objectContaining({ id: '7', id_product: '42', quantity: '10' }),
      );
    });

    it('should resolve successfully and not call updateResource when no stock_available row exists', async () => {
      client.createResource.mockResolvedValue({ id: '55', active: '1' });
      client.listResources.mockResolvedValue([]);

      const result = await adapter.publishProduct(baseCommand({ stock: 3 }));

      expect(result).toEqual({ externalProductId: '55', status: 'published' });
      expect(client.updateResource).not.toHaveBeenCalled();
    });

    it('should throw ProductPublishRejectedException on 4xx PrestashopApiException', async () => {
      client.createResource.mockRejectedValue(
        new PrestashopApiException('Invalid product data', 400),
      );

      await expect(adapter.publishProduct(baseCommand())).rejects.toMatchObject({
        name: 'ProductPublishRejectedException',
        statusCode: 400,
      });
      await expect(adapter.publishProduct(baseCommand())).rejects.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should propagate PrestashopAuthenticationException (401) unchanged', async () => {
      const err = new PrestashopAuthenticationException('Unauthorized', CONNECTION_ID);
      client.createResource.mockRejectedValue(err);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should propagate 5xx PrestashopApiException unchanged', async () => {
      const err = new PrestashopApiException('Gateway timeout', 503);
      client.createResource.mockRejectedValue(err);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });
  });

  describe('provisionCategory', () => {
    it('should reuse an existing category by exact name+parent match', async () => {
      client.listResources.mockResolvedValue([
        { id: '5', name: 'Gadgets', id_parent: '0' },
        { id: '6', name: 'Gadgets Pro', id_parent: '0' }, // near-match, must not reuse
      ]);

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [{ sourceCategoryId: 'src-1', name: 'Gadgets' }],
      });

      expect(client.createResource).not.toHaveBeenCalled();
      expect(result).toEqual({ destinationCategoryId: '5' });
    });

    it('should create a missing root category and return its id', async () => {
      client.listResources.mockResolvedValue([]);
      client.createResource.mockResolvedValue({ id: '10', name: 'Electronics', id_parent: '0' });

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [{ sourceCategoryId: 'r', name: 'Electronics' }],
      });

      expect(client.createResource).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ destinationCategoryId: '10', createdPath: ['10'] });
    });

    it('should create hierarchical path root→leaf, threading parentId', async () => {
      client.listResources.mockResolvedValue([]);
      client.createResource
        .mockResolvedValueOnce({ id: '10', name: 'Electronics', id_parent: '0' })
        .mockResolvedValueOnce({ id: '11', name: 'Phones', id_parent: '10' });

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [
          { sourceCategoryId: 'r', name: 'Electronics' },
          { sourceCategoryId: 'l', name: 'Phones' },
        ],
      });

      expect(client.createResource).toHaveBeenNthCalledWith(
        1,
        'categories',
        expect.objectContaining({ id_parent: '0' }),
      );
      expect(client.createResource).toHaveBeenNthCalledWith(
        2,
        'categories',
        expect.objectContaining({ id_parent: '10' }),
      );
      expect(result).toEqual({ destinationCategoryId: '11', createdPath: ['10', '11'] });
    });

    it('should include createdPath only for created nodes (mixed found/created)', async () => {
      client.listResources
        .mockResolvedValueOnce([{ id: '5', name: 'Gadgets', id_parent: '0' }]) // root found
        .mockResolvedValueOnce([]); // leaf absent
      client.createResource.mockResolvedValue({
        id: '20',
        name: 'Smart Gadgets',
        id_parent: '5',
      });

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [
          { sourceCategoryId: 'r', name: 'Gadgets' },
          { sourceCategoryId: 'l', name: 'Smart Gadgets' },
        ],
      });

      expect(result).toEqual({ destinationCategoryId: '20', createdPath: ['20'] });
    });
  });
});
