/**
 * PrestaShop Product Publisher Adapter — unit spec
 *
 * Covers `publishProduct` (create vs upsert, status mapping, multi-category,
 * platformParams passthrough, 4xx → rejection, 5xx propagation, 401 propagation,
 * image upload best-effort, feature/parameter provisioning)
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
    uploadImage: jest.fn(),
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

    it('should stamp reference = internalVariantId on create (idempotency key, #1107)', async () => {
      client.createResource.mockResolvedValue({ id: '100', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(baseCommand({ internalVariantId: 'ol_variant_xyz' }));

      const body = client.createResource.mock.calls[0][1] as { reference?: string };
      expect(body.reference).toBe('ol_variant_xyz');
    });

    it('should adopt an orphaned product by reference instead of creating a duplicate (#1107)', async () => {
      // A prior create succeeded but core never persisted the mapping (orphan).
      client.listResources.mockImplementation((resource) => {
        if (resource === 'products') {
          return Promise.resolve([{ id: '900', reference: 'ol_variant_aaaa' }]);
        }
        return Promise.resolve([{ id: '1', id_product: '900', quantity: '0' }]); // stock_availables
      });
      client.updateResource
        .mockResolvedValueOnce({ id: '900', active: '1' }) // adopted product update
        .mockResolvedValueOnce({ id: '1' }); // stock update

      const result = await adapter.publishProduct(baseCommand()); // no externalProductId → create path

      expect(client.createResource).not.toHaveBeenCalled();
      expect(client.listResources).toHaveBeenCalledWith('products', {
        custom: { 'filter[reference]': 'ol_variant_aaaa' },
      });
      expect(client.updateResource).toHaveBeenNthCalledWith(
        1,
        'products',
        '900',
        expect.objectContaining({ id: '900', reference: 'ol_variant_aaaa' }),
      );
      expect(result.externalProductId).toBe('900');
    });

    it('should propagate a reference-lookup failure rather than risk a duplicate (#1107)', async () => {
      // An ambiguous lookup (transport error) must NOT fall through to create.
      client.listResources.mockRejectedValue(new PrestashopApiException('WS down', 503));

      await expect(adapter.publishProduct(baseCommand())).rejects.toBeInstanceOf(
        PrestashopApiException,
      );
      expect(client.createResource).not.toHaveBeenCalled();
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
      client.listResources.mockImplementation((resource) =>
        resource === 'products'
          ? Promise.resolve([]) // no orphan → create path
          : Promise.resolve([{ id: '7', id_product: '42', quantity: '0' }]),
      );
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

    it('should resolve successfully when stock_availables WS call throws (best-effort stock)', async () => {
      // If updateStock throws, publishProduct must still return the result so that the
      // core service can persist the identifier mapping. A raw throw would prevent mapping
      // persistence and cause the next retry to call createResource again, producing a
      // duplicate orphaned PS product.
      client.createResource.mockResolvedValue({ id: '77', active: '1' });
      // The reference lookup ('products') must succeed (miss → create); only the
      // stock_availables read throws, exercising the best-effort stock path.
      client.listResources.mockImplementation((resource) =>
        resource === 'products'
          ? Promise.resolve([])
          : Promise.reject(new PrestashopApiException('WS error', 503)),
      );

      const result = await adapter.publishProduct(baseCommand({ stock: 5 }));

      expect(result).toEqual({ externalProductId: '77', status: 'published' });
      expect(client.updateResource).not.toHaveBeenCalled();
    });

    it('should throw ProductPublishRejectedException on 4xx PrestashopApiException', async () => {
      client.createResource.mockRejectedValue(
        new PrestashopApiException('Invalid product data', 400),
      );
      client.listResources.mockResolvedValue([]); // create path: no orphan → reaches createResource

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
      client.listResources.mockResolvedValue([]);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should propagate 5xx PrestashopApiException unchanged', async () => {
      const err = new PrestashopApiException('Gateway timeout', 503);
      client.createResource.mockRejectedValue(err);
      client.listResources.mockResolvedValue([]);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should upload images via client.uploadImage after product creation', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);
      client.uploadImage.mockResolvedValue({ id: 'img-1' });
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)),
        headers: { get: (_h: string) => 'image/jpeg' },
      } as unknown as Response);

      const result = await adapter.publishProduct(
        baseCommand({
          content: { title: 'Widget', description: 'A widget', imageUrls: ['https://example.com/img.jpg'] },
        }),
      );

      expect(client.uploadImage).toHaveBeenCalledWith(
        'images/products/1',
        expect.any(Uint8Array),
        'image/jpeg',
        'img.jpg',
      );
      expect(result.warnings).toBeUndefined();
      expect(result.externalProductId).toBe('1');
      fetchSpy.mockRestore();
    });

    it('should provision features and associate them on the product body', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'product_features') return Promise.resolve([]);
        if (resource === 'product_feature_values') return Promise.resolve([]);
        if (resource === 'stock_availables')
          return Promise.resolve([{ id: '9', id_product: '1', quantity: '0' }]);
        return Promise.resolve([]); // products orphan lookup
      });
      client.createResource.mockImplementation((resource: string) => {
        if (resource === 'product_features') return Promise.resolve({ id: '10', name: 'brand' });
        if (resource === 'product_feature_values')
          return Promise.resolve({ id: '20', id_feature: '10', value: 'Acme' });
        return Promise.resolve({ id: '1', active: '1' }); // products
      });
      client.updateResource.mockResolvedValue({ id: '9' });

      const result = await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
      );

      expect(result.externalProductId).toBe('1');
      expect(result.warnings).toBeUndefined();
      const productBody = client.createResource.mock.calls.find((c) => c[0] === 'products')?.[1];
      expect((productBody?.associations as Record<string, unknown>)?.product_features).toEqual({
        product_feature: [{ id: '10', id_feature_value: '20' }],
      });
    });

    it('should derive result status from response.active, not cmd.status', async () => {
      // PS echoes back the persisted state; the contract requires observing it.
      client.createResource.mockResolvedValue({ id: '1', active: '0' }); // PS persisted draft
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(baseCommand({ status: 'published' }));

      expect(result.status).toBe('draft');
    });

    it('should use rootCategoryId sentinel (2) when destinationCategoryIds is empty', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(baseCommand({ destinationCategoryIds: [] }));

      const body = client.createResource.mock.calls[0][1];
      // '0' is not a valid PS parent; Home (id 2) is the first visible level
      expect(body.id_category_default).toBe('2');
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
        // root sentinel is PS Home (id 2), not 0 — see provisionCategory comment
        expect.objectContaining({ id_parent: '2' }),
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

  describe('image upload', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)),
        headers: { get: (_h: string) => 'image/jpeg' },
      } as unknown as Response);
      client.uploadImage.mockResolvedValue({ id: 'img-1' });
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should call client.uploadImage with correct resource path', async () => {
      client.createResource.mockResolvedValue({ id: '42', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(
        baseCommand({ content: { title: 'Widget', imageUrls: ['https://cdn.example/photo.jpg'] } }),
      );

      expect(client.uploadImage).toHaveBeenCalledWith(
        'images/products/42',
        expect.any(Uint8Array),
        'image/jpeg',
        'photo.jpg',
      );
    });

    it('should upload all imageUrls in order', async () => {
      client.createResource.mockResolvedValue({ id: '5', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(
        baseCommand({
          content: {
            title: 'Widget',
            imageUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.png'],
          },
        }),
      );

      expect(client.uploadImage).toHaveBeenCalledTimes(2);
      expect(client.uploadImage).toHaveBeenNthCalledWith(
        1,
        'images/products/5',
        expect.any(Uint8Array),
        'image/jpeg',
        'a.jpg',
      );
      expect(client.uploadImage).toHaveBeenNthCalledWith(
        2,
        'images/products/5',
        expect.any(Uint8Array),
        'image/jpeg',
        'b.png',
      );
    });

    it('should not call client.uploadImage when no imageUrls provided', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(baseCommand());

      expect(client.uploadImage).not.toHaveBeenCalled();
      expect(result.warnings).toBeUndefined();
    });

    it('should emit warning and continue when image fetch fails (best-effort)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      client.createResource.mockResolvedValue({ id: '3', active: '1' });
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(
        baseCommand({
          content: { title: 'Widget', imageUrls: ['https://cdn.example/broken.jpg'] },
        }),
      );

      expect(result.externalProductId).toBe('3');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('broken.jpg')]),
      );
      expect(client.uploadImage).not.toHaveBeenCalled();
    });

    it('should emit warning and continue when client.uploadImage throws (best-effort)', async () => {
      client.uploadImage.mockRejectedValue(new PrestashopApiException('Upload failed', 500));
      client.createResource.mockResolvedValue({ id: '7', active: '1' });
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(
        baseCommand({ content: { title: 'Widget', imageUrls: ['https://cdn.example/ok.jpg'] } }),
      );

      expect(result.externalProductId).toBe('7');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('ok.jpg')]),
      );
    });

    it('should continue uploading remaining images after one upload failure', async () => {
      client.uploadImage
        .mockRejectedValueOnce(new PrestashopApiException('first fail', 500))
        .mockResolvedValueOnce({ id: 'img-2' });
      client.createResource.mockResolvedValue({ id: '8', active: '1' });
      withDefaultStockMock(client);

      const result = await adapter.publishProduct(
        baseCommand({
          content: {
            title: 'Widget',
            imageUrls: ['https://cdn.example/fail.jpg', 'https://cdn.example/ok.jpg'],
          },
        }),
      );

      expect(client.uploadImage).toHaveBeenCalledTimes(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.externalProductId).toBe('8');
    });

    it('should strip mime-type parameters (e.g. charset) from content-type header', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)),
        headers: { get: (_h: string) => 'image/png; charset=utf-8' },
      } as unknown as Response);
      client.createResource.mockResolvedValue({ id: '9', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(
        baseCommand({ content: { title: 'Widget', imageUrls: ['https://cdn.example/img.png'] } }),
      );

      const [, , mimeType] = client.uploadImage.mock.calls[0];
      expect(mimeType).toBe('image/png');
    });
  });

  describe('parameter provisioning (features)', () => {
    function withFeaturesMock(
      c: jest.Mocked<IPrestashopWebserviceClient>,
      opts: {
        existingFeature?: { id: string; name: string };
        existingValue?: { id: string; id_feature: string; value: string };
        featureId?: string;
        featureValueId?: string;
      } = {},
    ): void {
      const { existingFeature, existingValue, featureId = '10', featureValueId = '20' } = opts;
      c.listResources.mockImplementation((resource: string) => {
        if (resource === 'product_features')
          return Promise.resolve(existingFeature ? [existingFeature] : []);
        if (resource === 'product_feature_values')
          return Promise.resolve(existingValue ? [existingValue] : []);
        if (resource === 'stock_availables')
          return Promise.resolve([{ id: '9', id_product: '1', quantity: '0' }]);
        return Promise.resolve([]); // products orphan lookup
      });
      c.createResource.mockImplementation((resource: string) => {
        if (resource === 'product_features')
          return Promise.resolve({ id: featureId, name: 'brand' });
        if (resource === 'product_feature_values')
          return Promise.resolve({ id: featureValueId, id_feature: featureId, value: 'Acme' });
        return Promise.resolve({ id: '1', active: '1' }); // products
      });
      c.updateResource.mockResolvedValue({ id: '9' });
    }

    it('should create feature when no match exists', async () => {
      withFeaturesMock(client);

      await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
      );

      expect(client.createResource).toHaveBeenCalledWith(
        'product_features',
        expect.objectContaining({ name: expect.anything() }),
      );
    });

    it('should reuse an existing feature by name match', async () => {
      withFeaturesMock(client, { existingFeature: { id: '5', name: 'brand' } });

      await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
      );

      const featureCreates = client.createResource.mock.calls.filter(
        (c) => c[0] === 'product_features',
      );
      expect(featureCreates).toHaveLength(0);
    });

    it('should create feature value when not found under the feature', async () => {
      withFeaturesMock(client);

      await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
      );

      expect(client.createResource).toHaveBeenCalledWith(
        'product_feature_values',
        expect.objectContaining({ id_feature: '10' }),
      );
    });

    it('should reuse an existing feature value by value match', async () => {
      withFeaturesMock(client, {
        existingFeature: { id: '5', name: 'brand' },
        existingValue: { id: '15', id_feature: '5', value: 'Acme' },
      });

      await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
      );

      const valueCreates = client.createResource.mock.calls.filter(
        (c) => c[0] === 'product_feature_values',
      );
      expect(valueCreates).toHaveLength(0);
    });

    it('should produce one association per parameter value', async () => {
      withFeaturesMock(client);

      await adapter.publishProduct(
        baseCommand({
          parameters: [
            { id: 'brand', values: ['Acme'], section: 'offer' },
            { id: 'color', values: ['Red'], section: 'offer' },
          ],
        }),
      );

      const productBody = client.createResource.mock.calls.find((c) => c[0] === 'products')?.[1];
      const featureList = (productBody?.associations as Record<string, unknown>)
        ?.product_features as { product_feature: unknown[] } | undefined;
      expect(featureList?.product_feature).toHaveLength(2);
    });

    it('should hard-fail and not create the product when feature lookup throws', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'product_features')
          return Promise.reject(new PrestashopApiException('WS error', 503));
        return Promise.resolve([]);
      });

      await expect(
        adapter.publishProduct(
          baseCommand({ parameters: [{ id: 'brand', values: ['Acme'], section: 'offer' }] }),
        ),
      ).rejects.toBeInstanceOf(PrestashopApiException);
      expect(client.createResource).not.toHaveBeenCalled();
    });

    it('should skip feature provisioning when parameters is empty', async () => {
      client.createResource.mockResolvedValue({ id: '1', active: '1' });
      withDefaultStockMock(client);

      await adapter.publishProduct(baseCommand({ parameters: [] }));

      const featureListCalls = client.listResources.mock.calls.filter(
        (c) => c[0] === 'product_features',
      );
      expect(featureListCalls).toHaveLength(0);
    });
  });
});
