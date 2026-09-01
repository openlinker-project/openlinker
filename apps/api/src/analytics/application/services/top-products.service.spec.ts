/**
 * Top Products Service — Unit Tests (#1988)
 */
import type { IOrderRecordService, TopProductsResult, VariantSalesResult } from '@openlinker/core/orders';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IPublishedVariantsService } from '@openlinker/core/listings';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import { TopProductsService } from './top-products.service';

describe('TopProductsService', () => {
  let orderRecordService: jest.Mocked<
    Pick<IOrderRecordService, 'getTopProducts' | 'getTopProductVariantSales'>
  >;
  let productsService: jest.Mocked<
    Pick<IProductsService, 'getProductsByIds' | 'getVariantsByProductIds' | 'getVariantsByProductId'>
  >;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let publishedVariantsService: jest.Mocked<IPublishedVariantsService>;
  let inventoryQueryService: jest.Mocked<Pick<IInventoryQueryService, 'getAvailabilityByVariantIds'>>;
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
    orderRecordService = { getTopProducts: jest.fn(), getTopProductVariantSales: jest.fn() };
    productsService = {
      getProductsByIds: jest.fn(),
      getVariantsByProductIds: jest.fn(),
      getVariantsByProductId: jest.fn(),
    };
    integrationsService = { listCapabilityAdapters: jest.fn() };
    publishedVariantsService = { getPublishedVariantIds: jest.fn() };
    inventoryQueryService = { getAvailabilityByVariantIds: jest.fn() };

    service = new TopProductsService(
      orderRecordService as unknown as IOrderRecordService,
      productsService as unknown as IProductsService,
      integrationsService as unknown as IIntegrationsService,
      publishedVariantsService,
      inventoryQueryService as unknown as IInventoryQueryService
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

  describe('getTopProductVariantSales (#2765)', () => {
    const salesFilters = { from: filters.from, to: filters.to };

    const channelRow = (variantId: string | null, overrides: Record<string, unknown> = {}) => ({
      variantId,
      sourceConnectionId: 'conn-a',
      units: 5,
      revenue: 50,
      unconvertedRevenue: 0,
      currency: 'EUR',
      unconvertedCurrency: null,
      netRevenue: 50,
      netExcludedRevenue: 0,
      netExcludedLineCount: 0,
      ...overrides,
    });

    const variantView = (variantId: string | null, overrides: Record<string, unknown> = {}) => ({
      variantId,
      units: 5,
      revenue: 50,
      unconvertedRevenue: 0,
      unconvertedOrderCount: 0,
      currency: 'EUR',
      unconvertedCurrency: null,
      netRevenue: 50,
      netExcludedRevenue: 0,
      netExcludedLineCount: 0,
      channels: [channelRow(variantId)],
      ...overrides,
    });

    it('enriches each variant row with its catalog sku/attributes and live stock', async () => {
      const core: VariantSalesResult = { productId: 'p1', variants: [variantView('v1')] };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([
        { ...variant('v1', 'p1'), sku: 'V-1', attributes: { Size: 'M' } },
      ]);
      inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v1', totalAvailable: 7, locationCount: 1 },
      ]);

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(orderRecordService.getTopProductVariantSales).toHaveBeenCalledWith('p1', salesFilters);
      expect(result.productId).toBe('p1');
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].sku).toBe('V-1');
      expect(result.variants[0].attributes).toEqual({ Size: 'M' });
      expect(result.variants[0].totalAvailable).toBe(7);
    });

    it('folds the null-variantId "Unassigned" bucket into the sole real variant', async () => {
      const core: VariantSalesResult = {
        productId: 'p1',
        variants: [
          variantView('v1', { units: 10, revenue: 100, netRevenue: 100, channels: [channelRow('v1', { units: 10, revenue: 100, netRevenue: 100 })] }),
          variantView(null, { units: 2, revenue: 20, netRevenue: 20, channels: [channelRow(null, { units: 2, revenue: 20, netRevenue: 20 })] }),
        ],
      };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([variant('v1', 'p1')]);
      inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].variantId).toBe('v1');
      expect(result.variants[0].units).toBe(12);
      expect(result.variants[0].revenue).toBe(120);
      expect(result.variants[0].channels).toHaveLength(1);
      expect(result.variants[0].channels[0].units).toBe(12);
      expect(result.variants[0].channels[0].revenue).toBe(120);
    });

    it('reports the "Unassigned" bucket as its own row when the product has more than one real variant', async () => {
      const core: VariantSalesResult = {
        productId: 'p1',
        variants: [variantView('v1'), variantView('v2'), variantView(null)],
      };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('v1', 'p1'),
        variant('v2', 'p1'),
      ]);
      inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(result.variants).toHaveLength(3);
      expect(result.variants.some((row) => row.variantId === null)).toBe(true);
    });

    it('reports the "Unassigned" bucket as its own row when the product has zero real variants', async () => {
      const core: VariantSalesResult = { productId: 'p1', variants: [variantView(null)] };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([]);
      inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].variantId).toBeNull();
    });

    it('never looks up stock for the "Unassigned" bucket, and reports totalAvailable: null for it', async () => {
      const core: VariantSalesResult = {
        productId: 'p1',
        variants: [variantView('v1'), variantView('v2'), variantView(null)],
      };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('v1', 'p1'),
        variant('v2', 'p1'),
      ]);
      inventoryQueryService.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'v1', totalAvailable: 3, locationCount: 1 },
        { productVariantId: 'v2', totalAvailable: 0, locationCount: 1 },
      ]);

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(inventoryQueryService.getAvailabilityByVariantIds).toHaveBeenCalledWith(['v1', 'v2']);
      const unassigned = result.variants.find((row) => row.variantId === null);
      expect(unassigned?.totalAvailable).toBeNull();
    });

    it('degrades to totalAvailable: null for every variant when the stock read fails, without failing the whole request', async () => {
      const core: VariantSalesResult = { productId: 'p1', variants: [variantView('v1')] };
      orderRecordService.getTopProductVariantSales.mockResolvedValue(core);
      productsService.getVariantsByProductId.mockResolvedValue([variant('v1', 'p1')]);
      inventoryQueryService.getAvailabilityByVariantIds.mockRejectedValue(new Error('boom'));

      const result = await service.getTopProductVariantSales('p1', salesFilters);

      expect(result.variants[0].totalAvailable).toBeNull();
    });
  });
});
