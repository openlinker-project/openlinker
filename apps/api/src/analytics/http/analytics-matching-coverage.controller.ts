/**
 * Analytics Matching Coverage Controller
 *
 * HTTP surface for the `'product-matching'` Data Coverage category's
 * paginated drill-down (#2474, Phase 7) — the mockup's `detail-mapping`
 * modal. Unlike currency/tax, this category has no remediation action of
 * its own (an `awaiting_mapping` order self-heals once the operator maps
 * the product; a `source_deleted` one needs the deletion itself
 * remediated, out of Data Coverage's scope) — so this controller carries
 * only the read, mirroring `AnalyticsTaxRemediationController.getOrders`
 * and `AnalyticsRemediationController.getAffectedOrders` byte-for-byte in
 * shape. No `@Roles` guard, for the same reason those two have none — a
 * read of the same shape `GET /analytics/coverage` already samples for
 * every authenticated user.
 *
 * @module apps/api/src/analytics/http
 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { ProductMatchingOrdersQueryDto } from './dto/product-matching-orders-query.dto';
import {
  ProductMatchingOrderDto,
  ProductMatchingOrdersResponseDto,
} from './dto/product-matching-orders-response.dto';

const DEFAULT_ORDERS_PAGE_SIZE = 25;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/coverage/matching')
export class AnalyticsMatchingCoverageController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  @Get('orders')
  @ApiOperation({
    summary: "Paginated list of orders OL couldn't fully match to a mapped product (detail-mapping modal)",
  })
  @ApiResponse({ status: 200, type: ProductMatchingOrdersResponseDto })
  async getOrders(
    @Query() query: ProductMatchingOrdersQueryDto
  ): Promise<ProductMatchingOrdersResponseDto> {
    const page = await this.orderRecordService.getProductMatchingErrorOrders(
      {
        sourceConnectionId: query.sourceConnectionId,
        createdFrom: new Date(query.from),
        createdTo: new Date(query.to),
      },
      { limit: query.limit ?? DEFAULT_ORDERS_PAGE_SIZE, offset: query.offset ?? 0 }
    );

    const response = new ProductMatchingOrdersResponseDto();
    response.items = page.items.map((row) => ProductMatchingOrderDto.fromRow(row));
    response.total = page.total;
    return response;
  }
}
