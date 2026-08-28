/**
 * Top Products Controller
 *
 * HTTP surface for the top-products table (#1988): products ranked by
 * revenue or units for a date range, each row carrying its own inline
 * per-channel breakdown, catalog display metadata, and a coverage-gap flag.
 * Unlike `SalesAnalyticsController` (a single-context `orders` read), this
 * delegates to the apps/api-layer `ITopProductsService`, which composes the
 * core `orders` ranking with cross-context enrichment from `products` and
 * `listings` — see that service's header for why the composition lives here
 * rather than in a core context.
 *
 * Also carries the per-product variant-sales drill-down (#2765) — a
 * separate, lazily-fetched route (`GET .../:productId/variants`), never a
 * field on the list rows above: see `ITopProductsService`'s doc for why.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { TopProductsResponseDto } from './dto/top-products-response.dto';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';
import { TopProductVariantsResponseDto } from './dto/top-product-variants-response.dto';
import {
  TOP_PRODUCTS_SERVICE_TOKEN,
  type ITopProductsService,
} from '../application/services/top-products.service.interface';

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class TopProductsController {
  constructor(
    @Inject(TOP_PRODUCTS_SERVICE_TOKEN)
    private readonly topProductsService: ITopProductsService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService
  ) {}

  @Get('top-products')
  @ApiOperation({
    summary:
      'Products ranked by revenue or units for a date range, with an inline per-channel breakdown',
    description:
      'Sorting by revenue only considers reporting-currency-stamped orders (see the per-row `currency`/`unconvertedRevenue`); a product whose orders are entirely unstamped ranks at revenue 0 and may not appear on this page at all, in which case its unconvertedRevenue is never surfaced either — sort by units to see it.',
  })
  @ApiResponse({ status: 200, type: TopProductsResponseDto })
  async getTopProducts(@Query() query: TopProductsQueryDto): Promise<TopProductsResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }

    // Read fresh on every request (#2469): the setting is an operator toggle
    // whose whole point is that it takes effect on the next query, and `orders`
    // cannot read it itself without an `orders -> analytics` edge.
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    return this.topProductsService.getTopProducts(
      {
        from,
        to,
        sourceConnectionId: query.sourceConnectionId,
        sortBy: query.sortBy ?? 'revenue',
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
      includeBackfilledTaxRatesInNetSales
    );
  }

  @Get('top-products/:productId/variants')
  @ApiParam({ name: 'productId', description: 'Internal product id' })
  @ApiOperation({
    summary: 'One product’s sales split by variant, per channel',
    description:
      'Lazy drill-down for the Top Products expand panel — fetch only when an operator expands the row, never for every row on the page. A variantId: null row is the "Unassigned" bucket (order lines that never resolved to a variant), reported as its own row unless the product has exactly one real variant.',
  })
  @ApiResponse({ status: 200, type: TopProductVariantsResponseDto })
  async getTopProductVariantSales(
    @Param('productId') productId: string,
    @Query() query: SalesAnalyticsQueryDto
  ): Promise<TopProductVariantsResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }

    return this.topProductsService.getTopProductVariantSales(productId, {
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
    });
  }
}
