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
 * and `AnalyticsRemediationController.getAffectedOrders` in shape, including
 * their `parseRange` guard (`to` must be after `from`, bounded to
 * `MAX_COVERAGE_RANGE_DAYS`) — duplicated rather than shared for the same
 * reason those two duplicate it from each other (three lines of
 * DTO-adjacent guard isn't worth a shared helper module). No `@Roles`
 * guard, for the same reason those two have none — a read of the same
 * shape `GET /analytics/coverage` already samples for every authenticated
 * user.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { ProductMatchingOrdersQueryDto } from './dto/product-matching-orders-query.dto';
import {
  ProductMatchingOrderDto,
  ProductMatchingOrdersResponseDto,
} from './dto/product-matching-orders-response.dto';

const DEFAULT_ORDERS_PAGE_SIZE = 25;

/** Mirrors `AnalyticsCoverageController`'s bound — see that controller. */
const MAX_COVERAGE_RANGE_DAYS = 400;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/coverage/matching')
export class AnalyticsMatchingCoverageController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('orders')
  @ApiOperation({
    summary: "Paginated list of orders OL couldn't fully match to a mapped product (detail-mapping modal)",
  })
  @ApiResponse({ status: 200, type: ProductMatchingOrdersResponseDto })
  async getOrders(
    @Query() query: ProductMatchingOrdersQueryDto
  ): Promise<ProductMatchingOrdersResponseDto> {
    const { from, to } = this.parseRange(query.from, query.to);

    const page = await this.orderRecordService.getProductMatchingErrorOrders(
      {
        sourceConnectionId: query.sourceConnectionId,
        createdFrom: from,
        createdTo: to,
      },
      { limit: query.limit ?? DEFAULT_ORDERS_PAGE_SIZE, offset: query.offset ?? 0 }
    );

    const response = new ProductMatchingOrdersResponseDto();
    response.items = page.items.map((row) => ProductMatchingOrderDto.fromRow(row));
    response.total = page.total;
    return response;
  }

  /**
   * Shared range validation. Duplicated from the sibling coverage
   * controllers rather than extracted — see their own comments on why a
   * shared helper isn't worth it for three lines of DTO-adjacent guard.
   */
  private parseRange(fromRaw: string, toRaw: string): { from: Date; to: Date } {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_COVERAGE_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_COVERAGE_RANGE_DAYS}-day limit`
      );
    }
    return { from, to };
  }
}
