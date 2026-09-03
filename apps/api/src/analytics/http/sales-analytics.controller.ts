/**
 * Sales Analytics Controller
 *
 * HTTP surface for the `/analytics` KPI-strip / by-channel table (#1987):
 * revenue, orders, AOV, median, units — headline and per source connection.
 * Single-context read (entirely inside `orders`), so this injects
 * `IOrderRecordService` directly rather than introducing an apps/api-layer
 * composition service (unlike `NeedsAttentionService`, which exists
 * specifically to fan out across two core contexts).
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';
import { SalesAnalyticsResponseDto } from './dto/sales-analytics-response.dto';
import { AnyRole } from '../../auth/decorators/any-role.decorator';

/**
 * Upper bound on a requested range (#1987 review, suggestion 3). Unbounded,
 * `getMedianOrderValue`'s `PERCENTILE_CONT` sorts the whole matching set with
 * no index able to serve it, and the daily aggregate groups across the whole
 * table — authenticated-only, so not a security issue, but one bookmarked
 * `from=1970-01-01&to=2100-01-01` URL is enough to cost a full scan on every
 * load.
 */
const MAX_SALES_ANALYTICS_RANGE_DAYS = 400;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class SalesAnalyticsController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  @AnyRole()
  @Get('sales')
  @ApiOperation({
    summary:
      'Revenue, orders, AOV, median, units for a date range — headline and per source connection',
  })
  @ApiResponse({ status: 200, type: SalesAnalyticsResponseDto })
  async getSalesAnalytics(
    @Query() query: SalesAnalyticsQueryDto
  ): Promise<SalesAnalyticsResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_SALES_ANALYTICS_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_SALES_ANALYTICS_RANGE_DAYS}-day limit`
      );
    }

    const analytics = await this.orderRecordService.getSalesAndChannelAnalytics({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
    });

    return SalesAnalyticsResponseDto.fromDomain(analytics);
  }
}
