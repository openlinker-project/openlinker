/**
 * Top Products Service — Unit Tests (#1988)
 */
import type { IOrderRecordService, TopProductsResult } from '@openlinker/core/orders';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IPublishedVariantsService } from '@openlinker/core/listings';
import { TopProductsService } from './top-products.service';

describe('TopProductsService', () => {
  let orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'getTopProducts'>>;
  let productsService: jest.Mocked<
    Pick<IProductsService, 'getProductsByIds' | 'getVariantsByProductIds'>
  >;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let publishedVariantsService: jest.Mocked<IPublishedVariantsService>;
  let service: TopProductsService;

  const filters = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'),
    sortBy: 'revenue' as const,
    limit: 20,
    offset: 0,
  };

  const product = (overrides: Partial<Product>): Product => ({
    id: 'p1',
    name: 'Widget',
    sku: 'SKU-1',
    price: 10,
    description: null,
    images: null,
    currency: 'EUR',
    ...overrides,
  });

  const variant = (id: string, productId: string): ProductVariant => ({
    id,
    productId,
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
  });

  const coreResult = (overrides: Partial<TopProductsResult> = {}): TopProductsResult => ({
    items: [
      {
        productId: 'p1',
        units: 10,
        revenue: 100,
        unconvertedRevenue: 0,
        unconvertedOrderCount: 0,
        currency: 'EUR',
        unconvertedCurrency: null,
        netRevenue: 100,
        netExcludedRevenue: 0,
        netExcludedLineCount: 0,
        channels: [
          {
            productId: 'p1',
            sourceConnectionId: 'conn-a',
            units: 10,
            revenue: 100,
            unconvertedRevenue: 0,
            currency: 'EUR',
            unconvertedCurrency: null,
            netRevenue: 100,
            netExcludedRevenue: 0,
            netExcludedLineCount: 0,
          },
        ],
      },
    ],
    total: 1,
    ...overrides,
  });

  beforeEach(() => {
    orderRecordService = { getTopProducts: jest.fn() };
    productsService = { getProductsByIds: jest.fn(), getVariantsByProductIds: jest.fn() };
    integrationsService = { listCapabilityAdapters: jest.fn() };
    publishedVariantsService = { getPublishedVariantIds: jest.fn() };

    service = new TopProductsService(
      orderRecordService as unknown as IOrderRecordService,
      productsService as unknown as IProductsService,
      integrationsService as unknown as IIntegrationsService,
      publishedVariantsService
    );
  });

  it('enriches each ranked product with its catalog name/sku', async () => {
    orderRecordService.getTopProducts.mockResolvedValue(coreResult());
    productsService.getProductsByIds.mockResolvedValue([product({ id: 'p1' })]);
    productsService.getVariantsByProductIds.mockResolvedValue([]);
    integrationsService.listCapabilityAdapters.mockResolvedValue([]);

    const result = await service.getTopProducts(filters);

    expect(productsService.getProductsByIds).toHaveBeenCalledWith(['p1']);
    expect(result.items[0].name).toBe('Widget');
    expect(result.items[0].sku).toBe('SKU-1');
    expect(result.unresolvedProductCount).toBe(0);
    expect(result.coverageGapAvailable).toBe(true);
  });

  it('never drops a row whose productId fails to resolve — renders null name/sku and counts it', async () => {
    orderRecordService.getTopProducts.mockResolvedValue(coreResult());
    productsService.getProductsByIds.mockResolvedValue([]); // resolver silently dropped p1
    productsService.getVariantsByProductIds.mockResolvedValue([]);
    integrationsService.listCapabilityAdapters.mockResolvedValue([]);

    const result = await service.getTopProducts(filters);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('p1');
    expect(result.items[0].name).toBeNull();
    expect(result.items[0].sku).toBeNull();
    expect(result.unresolvedProductCount).toBe(1);
  });

  describe('coverage-gap flag', () => {
    it('flags a listing-capable connection where none of the product’s variants are published', async () => {
      orderRecordService.getTopProducts.mockResolvedValue(coreResult());
      productsService.getProductsByIds.mockResolvedValue([product({ id: 'p1' })]);
      productsService.getVariantsByProductIds.mockResolvedValue([variant('v1', 'p1')]);
      integrationsService.listCapabilityAdapters.mockImplementation(({ capability }) =>
        Promise.resolve(
          capability === 'OfferManager'
            ? [{ connectionId: 'conn-a', connection: {} as never, adapter: {}, metadata: {} as never }]
            : [{ connectionId: 'conn-b', connection: {} as never, adapter: {}, metadata: {} as never }]
        )
      );
      publishedVariantsService.getPublishedVariantIds.mockImplementation((connectionId) =>
        Promise.resolve(connectionId === 'conn-a' ? ['v1'] : [])
      );

      const result = await service.getTopProducts(filters);

      expect(result.items[0].missingFromConnectionIds).toEqual(['conn-b']);
    });

    it('calls getPublishedVariantIds exactly once per connection, never once per product (O(connections) fan-out)', async () => {
      orderRecordService.getTopProducts.mockResolvedValue(
        coreResult({
          items: [
            { productId: 'p1', units: 1, revenue: 1, unconvertedRevenue: 0, unconvertedOrderCount: 0, currency: 'EUR', unconvertedCurrency: null, netRevenue: 1, netExcludedRevenue: 0, netExcludedLineCount: 0, channels: [] },
            { productId: 'p2', units: 1, revenue: 1, unconvertedRevenue: 0, unconvertedOrderCount: 0, currency: 'EUR', unconvertedCurrency: null, netRevenue: 1, netExcludedRevenue: 0, netExcludedLineCount: 0, channels: [] },
          ],
          total: 2,
        })
      );
      productsService.getProductsByIds.mockResolvedValue([product({ id: 'p1' }), product({ id: 'p2' })]);
      productsService.getVariantsByProductIds.mockImplementation((productIds) =>
        Promise.resolve(productIds.map((productId) => variant(`v-${productId}`, productId)))
      );
      integrationsService.listCapabilityAdapters.mockImplementation(({ capability }) =>
        Promise.resolve(
          capability === 'OfferManager'
            ? [
                { connectionId: 'conn-a', connection: {} as never, adapter: {}, metadata: {} as never },
                { connectionId: 'conn-b', connection: {} as never, adapter: {}, metadata: {} as never },
              ]
            : []
        )
      );
      publishedVariantsService.getPublishedVariantIds.mockResolvedValue([]);

      await service.getTopProducts(filters);

      expect(publishedVariantsService.getPublishedVariantIds).toHaveBeenCalledTimes(2); // 2 connections, not 2 connections × 2 products
      // one batch call for the whole page, not one call per product (#2172 review, SUGGESTION 4)
      expect(productsService.getVariantsByProductIds).toHaveBeenCalledTimes(1);
      expect(productsService.getVariantsByProductIds).toHaveBeenCalledWith(['p1', 'p2']);
    });

    it('degrades to an empty flag on every row and reports coverageGapAvailable: false when the coverage read fails, without failing the whole request', async () => {
      orderRecordService.getTopProducts.mockResolvedValue(coreResult());
      productsService.getProductsByIds.mockResolvedValue([product({ id: 'p1' })]);
      productsService.getVariantsByProductIds.mockRejectedValue(new Error('boom'));

      const result = await service.getTopProducts(filters);

      expect(result.items[0].missingFromConnectionIds).toEqual([]);
      expect(result.coverageGapAvailable).toBe(false);
    });

    it('skips the coverage read entirely when there are no products on the page', async () => {
      orderRecordService.getTopProducts.mockResolvedValue({ items: [], total: 0 });
      productsService.getProductsByIds.mockResolvedValue([]);

      const result = await service.getTopProducts(filters);

      expect(result.items).toEqual([]);
      expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
    });
  });
});
