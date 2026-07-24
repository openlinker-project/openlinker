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

    it('should map barcode, weight, short_description and tags when present', async () => {
      http.post.mockResolvedValue({ id: 20, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({
          barcode: '5901234123457',
          weight: 1.25,
          content: {
            title: 'Widget',
            shortDescription: 'Short blurb',
            tags: ['sale', 'new'],
          },
        }),
      );

      const body = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toMatchObject({
        global_unique_id: '5901234123457',
        weight: '1.25',
        short_description: 'Short blurb',
        tags: [{ name: 'sale' }, { name: 'new' }],
      });
    });

    it('should map the commerce block (sale price + schedule, dimensions, tax)', async () => {
      http.post.mockResolvedValue({ id: 21, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({
          commerce: {
            salePrice: { amount: 14.5, currency: 'PLN' },
            saleStartsAt: '2026-08-01T00:00:00Z',
            saleEndsAt: '2026-08-31T23:59:59Z',
            dimensions: { length: 10, width: 5, height: 2 },
            taxClass: 'reduced-rate',
            taxStatus: 'taxable',
          },
        }),
      );

      const body = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toMatchObject({
        sale_price: '14.5',
        // UTC input is written to the `_gmt` fields, not the site-local ones.
        date_on_sale_from_gmt: '2026-08-01T00:00:00Z',
        date_on_sale_to_gmt: '2026-08-31T23:59:59Z',
        dimensions: { length: '10', width: '5', height: '2' },
        tax_class: 'reduced-rate',
        tax_status: 'taxable',
      });
      expect(body).not.toHaveProperty('date_on_sale_from');
      expect(body).not.toHaveProperty('date_on_sale_to');
    });

    it('should omit an empty tags array so upsert does not clear existing WC tags', async () => {
      http.put.mockResolvedValue({ id: 30, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({ externalProductId: '30', content: { title: 'Widget', tags: [] } }),
      );

      expect(http.put.mock.calls[0][1]).not.toHaveProperty('tags');
    });

    it('should omit new fields when the command does not carry them', async () => {
      http.post.mockResolvedValue({ id: 22, status: 'publish' });

      await adapter.publishProduct(baseCommand());

      const body = http.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('global_unique_id');
      expect(body).not.toHaveProperty('weight');
      expect(body).not.toHaveProperty('short_description');
      expect(body).not.toHaveProperty('tags');
      expect(body).not.toHaveProperty('sale_price');
      expect(body).not.toHaveProperty('dimensions');
      expect(body).not.toHaveProperty('tax_class');
      expect(body).not.toHaveProperty('tax_status');
      expect(body).not.toHaveProperty('meta_data');
    });

    it('should map SEO title/description to Yoast + RankMath meta_data (#1833)', async () => {
      http.post.mockResolvedValue({ id: 23, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({
          content: {
            title: 'Widget',
            seo: { title: 'SEO Title', description: 'SEO Desc', slug: 'widget' },
          },
        }),
      );

      const body = http.post.mock.calls[0][1] as Record<string, unknown>;
      // Slug is per-item (base slug + slugified variant/sku discriminator, #1846 fix 4).
      expect(body.slug).toBe('widget-ol-variant-aaaa');
      expect(body.meta_data).toEqual([
        { key: '_yoast_wpseo_title', value: 'SEO Title' },
        { key: 'rank_math_title', value: 'SEO Title' },
        { key: '_yoast_wpseo_metadesc', value: 'SEO Desc' },
        { key: 'rank_math_description', value: 'SEO Desc' },
      ]);
    });

    it('should not emit meta_data when only the SEO slug is supplied', async () => {
      http.post.mockResolvedValue({ id: 24, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({ content: { title: 'Widget', seo: { slug: 'widget' } } }),
      );

      const body = http.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('meta_data');
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

    it('should propagate a 429 as transient (not a terminal rejection) so the job retries (#1846 fix 6)', async () => {
      const err = new WooCommerceHttpResponseException(429, 'Too many requests');
      http.post.mockRejectedValue(err);

      await expect(adapter.publishProduct(baseCommand())).rejects.toBe(err);
      await expect(adapter.publishProduct(baseCommand())).rejects.not.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should map an upsert 404 to ProductPublishTargetNotFoundException (stale mapping, #1846 fix 1)', async () => {
      http.put.mockRejectedValue(
        new WooCommerceHttpResponseException(404, 'Not found', 'woocommerce_rest_product_invalid_id'),
      );

      await expect(
        adapter.publishProduct(baseCommand({ externalProductId: '100' })),
      ).rejects.toMatchObject({
        name: 'ProductPublishTargetNotFoundException',
        externalProductId: '100',
      });
    });

    it('should keep a create 404 as a terminal rejection', async () => {
      http.post.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));

      await expect(adapter.publishProduct(baseCommand())).rejects.toBeInstanceOf(
        ProductPublishRejectedException,
      );
    });

    it('should drop a dictionary-only param (valuesIds, no values) instead of writing an empty attribute (#1846 fix 2)', async () => {
      http.post.mockResolvedValue({ id: 40, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({
          parameters: [
            { id: 'Color', values: ['Red'], section: 'product' },
            { id: 'Brand', valuesIds: ['555'], section: 'product' },
            { id: 'Empty', values: [], section: 'product' },
          ],
        }),
      );

      const body = http.post.mock.calls[0][1] as Record<string, unknown>;
      // Only the free-text param survives; dictionary-only + empty are dropped.
      expect(body.attributes).toEqual([{ name: 'Color', options: ['Red'], visible: true }]);
    });

    it('should omit the attributes key entirely when no param has free-text values (#1846 fix 2)', async () => {
      http.post.mockResolvedValue({ id: 41, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({ parameters: [{ id: 'Brand', valuesIds: ['555'], section: 'product' }] }),
      );

      expect(http.post.mock.calls[0][1]).not.toHaveProperty('attributes');
    });

    it('should build a per-item slug from the stable internal variant id, ignoring SKU (#1846 fix 4)', async () => {
      http.post.mockResolvedValue({ id: 42, status: 'publish' });

      // A SKU is present but must NOT drive the slug: the SKU can change over an
      // item's life, which would drift the WC permalink on a later upsert.
      await adapter.publishProduct(
        baseCommand({
          internalVariantId: 'ol_variant_xyz',
          sku: 'ABC-123',
          content: { title: 'Widget', seo: { slug: 'widget' } },
        }),
      );

      expect(http.post.mock.calls[0][1]).toMatchObject({ slug: 'widget-ol-variant-xyz' });
    });

    it('should keep the slug stable across upsert even if the SKU changes (#1846 fix 4)', async () => {
      http.post.mockResolvedValue({ id: 43, status: 'publish' });
      http.put.mockResolvedValue({ id: 43, status: 'publish' });

      // First publish without a SKU.
      await adapter.publishProduct(
        baseCommand({
          internalVariantId: 'ol_variant_stable',
          content: { title: 'Widget', seo: { slug: 'widget' } },
        }),
      );
      // Later upsert after the variant gained a SKU — slug must not drift.
      await adapter.publishProduct(
        baseCommand({
          internalVariantId: 'ol_variant_stable',
          sku: 'NEW-SKU',
          externalProductId: '43',
          content: { title: 'Widget', seo: { slug: 'widget' } },
        }),
      );

      expect(http.post.mock.calls[0][1]).toMatchObject({ slug: 'widget-ol-variant-stable' });
      expect(http.put.mock.calls[0][1]).toMatchObject({ slug: 'widget-ol-variant-stable' });
    });

    it('should build distinct per-item slugs for sibling variants sharing a base slug (#1846 fix 4)', async () => {
      http.post.mockResolvedValue({ id: 44, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({
          internalVariantId: 'ol_variant_1',
          content: { title: 'Widget', seo: { slug: 'widget' } },
        }),
      );
      await adapter.publishProduct(
        baseCommand({
          internalVariantId: 'ol_variant_2',
          content: { title: 'Widget', seo: { slug: 'widget' } },
        }),
      );

      expect(http.post.mock.calls[0][1]).toMatchObject({ slug: 'widget-ol-variant-1' });
      expect(http.post.mock.calls[1][1]).toMatchObject({ slug: 'widget-ol-variant-2' });
    });

    it('should send images on create but omit them on upsert to avoid re-sideloading (#1846 fix 7)', async () => {
      http.post.mockResolvedValue({ id: 44, status: 'publish' });
      http.put.mockResolvedValue({ id: 44, status: 'publish' });

      await adapter.publishProduct(
        baseCommand({ content: { title: 'Widget', imageUrls: ['http://img/1.png'] } }),
      );
      expect(http.post.mock.calls[0][1]).toMatchObject({ images: [{ src: 'http://img/1.png' }] });

      await adapter.publishProduct(
        baseCommand({
          externalProductId: '44',
          content: { title: 'Widget', imageUrls: ['http://img/1.png'] },
        }),
      );
      expect(http.put.mock.calls[0][1]).not.toHaveProperty('images');
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

    it('should query the category search with a large per_page so the exact match is not truncated (#1846 fix 3)', async () => {
      http.get.mockResolvedValue([{ id: 5, name: 'Gadgets', parent: 0, slug: 'gadgets' }]);

      await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [{ sourceCategoryId: 'src-1', name: 'Gadgets' }],
      });

      expect(http.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/categories',
        expect.objectContaining({ per_page: 100 }),
      );
    });

    it('should recover from a concurrent term_exists 4xx by reusing the existing node (#1846 fix 3)', async () => {
      http.get
        .mockResolvedValueOnce([]) // first find: absent (race window)
        .mockResolvedValueOnce([{ id: 77, name: 'Gadgets', parent: 0, slug: 'gadgets' }]); // re-find after term_exists
      http.post.mockRejectedValueOnce(
        new WooCommerceHttpResponseException(400, 'Term exists', 'term_exists'),
      );

      const result = await adapter.provisionCategory({
        connectionId: CONNECTION_ID,
        path: [{ sourceCategoryId: 'src-1', name: 'Gadgets' }],
      });

      // Reused the racing winner's node; not reported as newly created.
      expect(result).toEqual({ destinationCategoryId: '77' });
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

  describe('browseCategories', () => {
    it('should list root categories with parent=0 when no parentId is given', async () => {
      http.get.mockResolvedValue([
        { id: 10, name: 'Clothing', parent: 0, slug: 'clothing' },
        { id: 11, name: 'Shoes', parent: 0, slug: 'shoes' },
      ]);

      const result = await adapter.browseCategories();

      expect(http.get).toHaveBeenCalledTimes(1);
      const [path, params] = http.get.mock.calls[0];
      expect(path).toBe('/wp-json/wc/v3/products/categories');
      expect(params).toMatchObject({ parent: 0, per_page: 100, page: 1 });
      expect(result).toEqual([
        { id: '10', name: 'Clothing', parentId: null },
        { id: '11', name: 'Shoes', parentId: null },
      ]);
    });

    it('should drill into a parent and map parentId from the parent number', async () => {
      http.get.mockResolvedValue([{ id: 20, name: 'Sneakers', parent: 11, slug: 'sneakers' }]);

      const result = await adapter.browseCategories('11');

      expect(http.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/categories',
        expect.objectContaining({ parent: 11, page: 1 }),
      );
      expect(result).toEqual([{ id: '20', name: 'Sneakers', parentId: '11' }]);
    });

    it('should page through until a short page is returned', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Cat ${i + 1}`,
        parent: 0,
        slug: `cat-${i + 1}`,
      }));
      http.get
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([{ id: 101, name: 'Cat 101', parent: 0, slug: 'cat-101' }]);

      const result = await adapter.browseCategories();

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        '/wp-json/wc/v3/products/categories',
        expect.objectContaining({ page: 2 }),
      );
      expect(result).toHaveLength(101);
    });

    it('should treat a non-numeric parentId as root (parent=0)', async () => {
      http.get.mockResolvedValue([]);

      await adapter.browseCategories('not-a-number');

      expect(http.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/categories',
        expect.objectContaining({ parent: 0 }),
      );
    });

    it('should stop at the 50-page cap when the endpoint always returns a full page', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Cat ${i + 1}`,
        parent: 0,
        slug: `cat-${i + 1}`,
      }));
      // Always a full page — without the cap this would loop forever.
      http.get.mockResolvedValue(fullPage);
      const warnSpy = jest
        .spyOn(
          (adapter as unknown as { logger: { warn: (msg: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      const result = await adapter.browseCategories();

      expect(http.get).toHaveBeenCalledTimes(50);
      expect(result).toHaveLength(5000);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('50-page cap'));
    });
  });
});
