/**
 * MarginAnalyticsApiService Unit Tests (#3588)
 *
 * @module apps/api/src/analytics/application/services
 */
import type { IMarginAnalyticsService, MarginFigures } from '@openlinker/core/orders';
import type { IProductsService } from '@openlinker/core/products';
import { MarginAnalyticsApiService } from './margin-analytics-api.service';

const figures: MarginFigures = {
  netRevenue: 100,
  coveredNetRevenue: 100,
  costOfGoods: 60,
  grossMargin: 40,
  marginPct: 0.4,
  costCoveragePct: 1,
  gaps: [],
};

describe('MarginAnalyticsApiService', () => {
  const filters = { from: new Date('2026-09-01'), to: new Date('2026-09-08') };

  it('adds catalogue names and counts unresolved products', async () => {
    const margin = {
      getMarginProducts: jest.fn().mockResolvedValue({
        currency: 'PLN',
        total: 2,
        items: [
          { productId: 'p1', ...figures },
          { productId: 'gone', ...figures },
        ],
      }),
    };
    const products = {
      getProductsByIds: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Mug', sku: 'MUG-1' }]),
    };
    const service = new MarginAnalyticsApiService(
      margin as unknown as IMarginAnalyticsService,
      products as unknown as IProductsService
    );

    const result = await service.getMarginProducts(
      { ...filters, sortBy: 'grossMargin', limit: 20, offset: 0 },
      true
    );

    expect(margin.getMarginProducts).toHaveBeenCalledWith(expect.anything(), true);
    expect(result.items[0]).toMatchObject({
      productId: 'p1',
      name: 'Mug',
      sku: 'MUG-1',
      grossMargin: 40,
    });
    expect(result.items[1]).toMatchObject({ productId: 'gone', name: null, sku: null });
    expect(result.unresolvedProductCount).toBe(1);
    expect(result.total).toBe(2);
  });

  it('adds variant sku and attributes, leaving the unresolved bucket bare', async () => {
    const margin = {
      getMarginProductVariants: jest.fn().mockResolvedValue({
        currency: 'PLN',
        productId: 'p1',
        variants: [
          { variantId: 'v1', ...figures },
          { variantId: null, ...figures },
        ],
      }),
    };
    const products = {
      getVariantsByProductId: jest
        .fn()
        .mockResolvedValue([{ id: 'v1', sku: 'MUG-RED', attributes: { Color: 'Red' } }]),
    };
    const service = new MarginAnalyticsApiService(
      margin as unknown as IMarginAnalyticsService,
      products as unknown as IProductsService
    );

    const result = await service.getMarginProductVariants('p1', filters);

    expect(result.variants[0]).toMatchObject({
      variantId: 'v1',
      sku: 'MUG-RED',
      attributes: { Color: 'Red' },
    });
    expect(result.variants[1]).toMatchObject({ variantId: null, sku: null, attributes: null });
  });
});
