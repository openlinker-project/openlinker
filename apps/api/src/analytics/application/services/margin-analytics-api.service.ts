/**
 * Margin Analytics API Service
 *
 * Adds product names/SKUs and variant SKUs/attributes to the core margin reads
 * (#3588). Lives at the apps/api layer for the same reason `TopProductsService`
 * does: `orders` must not depend on `products` for display metadata. Cost is
 * NEVER read from the catalogue here - every figure comes from the per-line
 * snapshot, so editing a variant cost cannot move an earlier margin.
 *
 * @module apps/api/src/analytics/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  MARGIN_ANALYTICS_SERVICE_TOKEN,
  type IMarginAnalyticsService,
  type MarginProductFilters,
  type SalesAnalyticsFilters,
} from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  MarginProductRowDto,
  MarginProductsResponseDto,
  MarginProductVariantsResponseDto,
  MarginVariantRowDto,
} from '../../http/dto/margin-analytics-response.dto';
import type { IMarginAnalyticsApiService } from './margin-analytics-api.service.interface';

@Injectable()
export class MarginAnalyticsApiService implements IMarginAnalyticsApiService {
  constructor(
    @Inject(MARGIN_ANALYTICS_SERVICE_TOKEN)
    private readonly marginAnalytics: IMarginAnalyticsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  async getMarginProducts(
    filters: MarginProductFilters,
    includeBackfilledTaxRatesInNetSales = false
  ): Promise<MarginProductsResponseDto> {
    const core = await this.marginAnalytics.getMarginProducts(
      filters,
      includeBackfilledTaxRatesInNetSales
    );
    const products = await this.productsService.getProductsByIds(
      core.items.map((item) => item.productId)
    );
    const productById = new Map(products.map((product) => [product.id, product]));

    let unresolvedProductCount = 0;
    const dto = new MarginProductsResponseDto();
    dto.currency = core.currency;
    dto.total = core.total;
    dto.items = core.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        unresolvedProductCount += 1;
      }
      const row = new MarginProductRowDto();
      row.assignFigures(item);
      row.productId = item.productId;
      row.name = product?.name ?? null;
      row.sku = product?.sku ?? null;
      return row;
    });
    dto.unresolvedProductCount = unresolvedProductCount;
    return dto;
  }

  async getMarginProductVariants(
    productId: string,
    filters: SalesAnalyticsFilters,
    includeBackfilledTaxRatesInNetSales = false
  ): Promise<MarginProductVariantsResponseDto> {
    const core = await this.marginAnalytics.getMarginProductVariants(
      productId,
      filters,
      includeBackfilledTaxRatesInNetSales
    );
    const catalogVariants = await this.productsService.getVariantsByProductId(productId);
    const catalogByVariantId = new Map(catalogVariants.map((variant) => [variant.id, variant]));

    const dto = new MarginProductVariantsResponseDto();
    dto.currency = core.currency;
    dto.productId = core.productId;
    dto.variants = core.variants.map((variant) => {
      const catalog = variant.variantId ? catalogByVariantId.get(variant.variantId) : undefined;
      const row = new MarginVariantRowDto();
      row.assignFigures(variant);
      row.variantId = variant.variantId;
      row.sku = catalog?.sku ?? null;
      row.attributes = catalog?.attributes ?? null;
      return row;
    });
    return dto;
  }
}
