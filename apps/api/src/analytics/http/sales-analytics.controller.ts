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

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class SalesAnalyticsController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

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

    const analytics = await this.orderRecordService.getSalesAndChannelAnalytics({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
    });

    return SalesAnalyticsResponseDto.fromDomain(analytics);
  }
}
