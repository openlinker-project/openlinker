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
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { TopProductsResponseDto } from './dto/top-products-response.dto';
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
    private readonly topProductsService: ITopProductsService
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

    return this.topProductsService.getTopProducts({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
      sortBy: query.sortBy ?? 'revenue',
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
  }
}
