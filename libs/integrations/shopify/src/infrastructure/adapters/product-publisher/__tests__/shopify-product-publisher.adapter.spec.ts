import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  isCategoryProvisioner,
  isShopAttributeReader,
  isShopCategoryBrowser,
  isShopCurrencyDeclarer,
  isShopProductPriceUpdater,
  ProductPublishRejectedException,
  type PublishProductCommand,
} from '@openlinker/core/listings';

import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import type { ShopifyTaxRateReader } from '../../../tax/shopify-tax-rate.reader';
import { ShopifyProductPublisherAdapter } from '../shopify-product-publisher.adapter';

const LOCATION = 'gid://shopify/Location/1';

/** The reason lives in `errors[].message`; the exception message stays neutral (core contract). */
async function expectRejected(promise: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProductPublishRejectedException);
  expect((error as ProductPublishRejectedException).errors.map((e) => e.message).join(' | ')).toMatch(reason);
}

function cmd(overrides: Partial<PublishProductCommand> = {}): PublishProductCommand {
  return {
    internalVariantId: 'v1',
    connectionId: 'c1',
    destinationCategoryIds: [],
    price: { amount: 123, currency: 'PLN' },
    stock: 7,
    status: 'draft',
    content: { title: 'Shirt' },
    taxRate: '23',
    ...overrides,
  } as PublishProductCommand;
}

const product = (variantId = 'gid://shopify/ProductVariant/9'): Record<string, unknown> => ({
  id: 'gid://shopify/Product/5',
  status: 'DRAFT',
  media: { nodes: [] },
  collections: { nodes: [] },
  options: [{ name: 'Title' }],
  variants: { nodes: [{ id: variantId, selectedOptions: [{ name: 'Title', value: 'Default Title' }], inventoryItem: null }] },
});

interface Harness {
  readonly adapter: ShopifyProductPublisherAdapter;
  readonly query: jest.Mock;
  readonly mutate: jest.Mock;
  readonly taxRead: jest.Mock;
}

function build(
  options: { taxesIncluded?: boolean; capabilities?: string[]; rate?: string | null } = {},
): Harness {
  const query = jest.fn();
  const mutate = jest.fn();
  const taxRead = jest
    .fn()
    .mockResolvedValue(
      options.rate === null
        ? { kind: 'unknown', reason: 'not-configured' }
        : { kind: 'resolved', code: options.rate ?? '23', countryIso2: 'PL' },
    );
  const shopContext = {
    get: jest.fn().mockResolvedValue({
      currencyCode: 'PLN',
      taxesIncluded: options.taxesIncluded ?? false,
      locationGid: LOCATION,
    }),
  } as unknown as ShopifyShopContextProvider;
  const connection = {
    id: 'c1',
    adapterKey: 'shopify.admin.v1',
    enabledCapabilities: options.capabilities ?? ['ProductPublisher'],
  } as unknown as Connection;
  const adapter = new ShopifyProductPublisherAdapter(
    { query, mutate } as unknown as ShopifyGraphqlClient,
    shopContext,
    connection,
    { read: taxRead } as unknown as ShopifyTaxRateReader,
  );
  return { adapter, query, mutate, taxRead };
}

describe('ShopifyProductPublisherAdapter', () => {
  it('should declare the sub-capabilities core narrows it by', () => {
    const { adapter } = build();

    expect(isCategoryProvisioner(adapter)).toBe(true);
    expect(isShopCategoryBrowser(adapter)).toBe(true);
    expect(isShopAttributeReader(adapter)).toBe(true);
    expect(isShopCurrencyDeclarer(adapter)).toBe(true);
    expect(isShopProductPriceUpdater(adapter)).toBe(true);
  });

  describe('publishProduct', () => {
    it('should create a simple product with the net price and its stock at the location', async () => {
      const h = build();
      h.mutate.mockResolvedValueOnce({ product: product() });

      await expect(h.adapter.publishProduct(cmd())).resolves.toEqual({
        externalProductId: '5',
        externalVariantId: '9',
        status: 'draft',
      });

      const [, variables, field] = h.mutate.mock.calls[0] as [string, { input: Record<string, unknown> }, string];
      expect(field).toBe('productSet');
      expect(variables.input).toMatchObject({
        status: 'DRAFT',
        title: 'Shirt',
        variants: [
          {
            price: '100.00',
            inventoryQuantities: [{ locationId: LOCATION, name: 'available', quantity: 7 }],
          },
        ],
      });
    });

    it('should send the gross price to a shop that enters prices with tax', async () => {
      const h = build({ taxesIncluded: true });
      h.mutate.mockResolvedValueOnce({ product: product() });

      await h.adapter.publishProduct(cmd({ taxRate: undefined }));

      const [, variables] = h.mutate.mock.calls[0] as [string, { input: { variants: Array<{ price: string }> } }];
      expect(variables.input.variants[0].price).toBe('123.00');
    });

    it('should refuse a connection that is also the product master before anything is sent', async () => {
      const h = build({ capabilities: ['ProductMaster', 'ProductPublisher'] });

      await expect(h.adapter.publishProduct(cmd())).rejects.toBeInstanceOf(ProductPublishRejectedException);
      expect(h.mutate).not.toHaveBeenCalled();
    });

    it('should refuse a tax-exclusive shop when the catalogue holds no rate', async () => {
      const h = build();

      await expectRejected(h.adapter.publishProduct(cmd({ taxRate: undefined })), /VAT rate/);
      expect(h.mutate).not.toHaveBeenCalled();
    });

    it('should refuse a price in another currency', async () => {
      const h = build();

      await expectRejected(h.adapter.publishProduct(cmd({ price: { amount: 10, currency: 'EUR' } })), /currency/);
    });

    it('should refuse to update a product that no longer has exactly one variant', async () => {
      const h = build();
      h.query.mockResolvedValueOnce({
        product: { ...product(), variants: { nodes: [{ id: 'a' }, { id: 'b' }] } },
      });

      await expectRejected(h.adapter.publishProduct(cmd({ externalProductId: '5' })), /2 variants/);
      expect(h.mutate).not.toHaveBeenCalled();
    });
  });

  describe('updateShopProductPrice', () => {
    it('should write the net price from the variant rate on a tax-exclusive shop', async () => {
      const h = build();
      h.query.mockResolvedValueOnce({
        nodes: [{ __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/9', product: { id: 'gid://shopify/Product/5' } }],
      });
      h.mutate.mockResolvedValueOnce({});

      await h.adapter.updateShopProductPrice({
        externalProductId: '9',
        externalParentProductId: '5',
        price: { amount: '123.00', currency: 'PLN' },
      } as never);

      const [, variables] = h.mutate.mock.calls[0] as [string, { variants: unknown[] }];
      expect(variables.variants).toEqual([{ id: 'gid://shopify/ProductVariant/9', price: '100.00' }]);
    });

    it('should refuse when the variant rate is unknown', async () => {
      const h = build({ rate: null });
      h.query.mockResolvedValueOnce({
        nodes: [{ __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/9', product: { id: 'gid://shopify/Product/5' } }],
      });

      await expectRejected(
        h.adapter.updateShopProductPrice({
          externalProductId: '9',
          externalParentProductId: '5',
          price: { amount: '123.00', currency: 'PLN' },
        } as never),
        /VAT rate/,
      );
      expect(h.mutate).not.toHaveBeenCalled();
    });
  });

  describe('browseCategories', () => {
    it('should list manual collections flat and nothing under a parent', async () => {
      const h = build();
      h.query.mockResolvedValueOnce({
        collections: {
          nodes: [{ id: 'gid://shopify/Collection/3', title: 'Shirts' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });

      await expect(h.adapter.browseCategories()).resolves.toEqual([{ id: '3', name: 'Shirts', parentId: null }]);
      await expect(h.adapter.browseCategories('3')).resolves.toEqual([]);
      expect(h.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('provisionCategory', () => {
    it('should reuse the collection that already holds the path handle', async () => {
      const h = build();
      h.query.mockResolvedValueOnce({ collectionByIdentifier: { id: 'gid://shopify/Collection/8', handle: 'men-shoes' } });

      await expect(
        h.adapter.provisionCategory({
          path: [
            { sourceCategoryId: '1', name: 'Men' },
            { sourceCategoryId: '2', name: 'Shoes' },
          ],
        } as never),
      ).resolves.toEqual({ destinationCategoryId: '8' });
      expect(h.query).toHaveBeenCalledWith(expect.any(String), { handle: 'men-shoes' });
      expect(h.mutate).not.toHaveBeenCalled();
    });
  });
});
