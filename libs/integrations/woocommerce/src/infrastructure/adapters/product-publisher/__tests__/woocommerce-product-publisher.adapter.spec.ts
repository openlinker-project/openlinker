/**
 * WooCommerce Product Publisher Adapter — unit spec
 *
 * Covers `publishProduct` (create vs upsert body + status mapping), 4xx →
 * `ProductPublishRejectedException`, non-4xx propagation, and `provisionCategory`
 * (find-vs-create, hierarchical parent threading). HTTP client is mocked.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  type PublishProductCommand,
} from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import { WooCommerceProductPublisherAdapter } from '../woocommerce-product-publisher.adapter';

const CONNECTION_ID = 'conn-wc-1';

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
}

const connection: Connection = {
  id: CONNECTION_ID,
  platformType: 'woocommerce',
  name: 'Test WC',
  status: 'active',
  config: { siteUrl: 'https://shop.example' } as Record<string, unknown>,
  credentialsRef: 'cred-1',
  adapterKey: 'woocommerce.restapi.v3',
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
    stock: 7,
    status: 'published',
    content: { title: 'Widget', description: 'A widget', imageUrls: ['http://img/1.png'] },
    parameters: [{ id: 'Color', values: ['Red'], section: 'product' }],
    ...overrides,
  };
}

describe('WooCommerceProductPublisherAdapter', () => {
  let http: jest.Mocked<IWooCommerceHttpClient>;
  let adapter: WooCommerceProductPublisherAdapter;

  beforeEach(() => {
    http = makeHttpClient();
    adapter = new WooCommerceProductPublisherAdapter(http, connection);
  });

  describe('publishProduct', () => {
    it('should POST a new simple product and map the response', async () => {
      http.post.mockResolvedValue({ id: 100, status: 'publish' });

      const result = await adapter.publishProduct(baseCommand());

      expect(http.post).toHaveBeenCalledTimes(1);
      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/wp-json/wc/v3/products');
      expect(body).toMatchObject({
        type: 'simple',
        status: 'publish',
        regular_price: '19.99',
        manage_stock: true,
        stock_quantity: 7,
        name: 'Widget',
        description: 'A widget',
        images: [{ src: 'http://img/1.png' }],
        categories: [{ id: 12 }],
        attributes: [{ name: 'Color', options: ['Red'], visible: true }],
      });
      // baseCommand carries no sku ⇒ the key must be absent. `toMatchObject`
      // above ignores missing keys, so this negative assertion is what guards
      // against the field being silently dropped again (#1485).
      expect(body).not.toHaveProperty('sku');
      expect(result).toEqual({ externalProductId: '100', status: 'published' });
    });

    it('should write the SKU to the body when the command carries one (create + upsert)', async () => {
      http.post.mockResolvedValue({ id: 5, status: 'publish' });
      http.put.mockResolvedValue({ id: 5, status: 'publish' });

      await adapter.publishProduct(baseCommand({ sku: 'SKU-1' }));
      expect(http.post.mock.calls[0][1]).toMatchObject({ sku: 'SKU-1' });

      await adapter.publishProduct(baseCommand({ sku: 'SKU-1', externalProductId: '5' }));
      expect(http.put.mock.calls[0][1]).toMatchObject({ sku: 'SKU-1' });
    });

    it('should omit the SKU key when the command has none', async () => {
      http.post.mockResolvedValue({ id: 6, status: 'publish' });

      await adapter.publishProduct(baseCommand());

      expect(http.post.mock.calls[0][1]).not.toHaveProperty('sku');
    });

    it('should PUT to the product id on upsert (externalProductId present)', async () => {
      http.put.mockResolvedValue({ id: 100, status: 'draft' });

      const result = await adapter.publishProduct(
        baseCommand({ externalProductId: '100', status: 'draft' }),
      );

      expect(http.post).not.toHaveBeenCalled();
      expect(http.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/100',
        expect.objectContaining({ status: 'draft' }),
      );
      expect(result).toEqual({ externalProductId: '100', status: 'draft' });
    });

    it('should let explicit fields win over platformParams', async () => {
      http.post.mockResolvedValue({ id: 1, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({ platformParams: { status: 'private', tax_class: 'reduced-rate' } }),
      );

      const body = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.status).toBe('publish'); // explicit beats platformParams
      expect(body.tax_class).toBe('reduced-rate'); // un-modeled knob passes through
    });

    it('should map a 4xx rejection to ProductPublishRejectedException', async () => {
      http.post.mockRejectedValue(
        new WooCommerceHttpResponseException(400, 'Invalid price', 'product_invalid_price'),
      );

      await expect(adapter.publishProduct(baseCommand())).rejects.toMatchObject({
        name: 'ProductPublishRejectedException',
        statusCode: 400,
        errors: [{ code: 'product_invalid_price', message: 'Invalid price' }],
      });
    });

    it('should propagate a 5xx (not a terminal rejection)', async () => {
      const err = new WooCommerceHttpResponseException(503, 'Service unavailable');
      http.post.mockRejectedValue(err);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });
  });

  describe('provisionCategory', () => {
    it('should reuse an exact name+parent match and not create', async () => {
      http.get.mockResolvedValue([
        { id: 5, name: 'Gadgets', parent: 0, slug: 'gadgets' },
        { id: 6, name: 'Gadgets Pro', parent: 0, slug: 'gadgets-pro' }, // fuzzy hit, must be ignored
      ]);

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [{ sourceCategoryId: 'src-1', name: 'Gadgets' }],
      });

      expect(http.post).not.toHaveBeenCalled();
      expect(result).toEqual({ destinationCategoryId: '5' });
    });

    it('should create missing nodes root→leaf, threading parent, and report createdPath', async () => {
      http.get
        .mockResolvedValueOnce([]) // root "Electronics" absent
        .mockResolvedValueOnce([]); // leaf "Phones" absent
      http.post
        .mockResolvedValueOnce({ id: 10, name: 'Electronics', parent: 0, slug: 'electronics' })
        .mockResolvedValueOnce({ id: 11, name: 'Phones', parent: 10, slug: 'phones' });

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [
          { sourceCategoryId: 'r', name: 'Electronics' },
          { sourceCategoryId: 'l', name: 'Phones' },
        ],
      });

      expect(http.post).toHaveBeenNthCalledWith(1, '/wp-json/wc/v3/products/categories', {
        name: 'Electronics',
        parent: 0,
      });
      expect(http.post).toHaveBeenNthCalledWith(2, '/wp-json/wc/v3/products/categories', {
        name: 'Phones',
        parent: 10,
      });
      expect(result).toEqual({ destinationCategoryId: '11', createdPath: ['10', '11'] });
    });
  });
});
