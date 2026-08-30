/**
 * Sales-Document Markets Controller (#2518, ADR-066)
 *
 * The market-discovery read: which countries the operator's orders arrive
 * from, with their order counts over a window, so an unconfigured market is
 * visible before somebody discovers it through missing documents.
 *
 * A READ, and only a read. It creates no rule, no country default and no
 * routing - auto-applying a template on detection would be a legal act taken
 * on the operator's behalf, which ADR-041 forbids and ADR-066 rejects
 * outright. Nothing on this controller writes.
 *
 * It is a separate controller from `SalesDocumentRulesController` despite
 * sharing the `sales-documents` prefix: that one is rule-engine CRUD against
 * the sales-document store, this is one derived read against the ORDERS store,
 * reached through `IOrderRecordService` (never a repository port across a
 * context boundary, per architecture-overview.md).
 *
 * Admin-guarded like its neighbour rather than merely authenticated: the only
 * consumer is `/settings/sales-documents`, which is admin-only in full, and a
 * looser guard here would publish the operator's market distribution to every
 * authenticated user for no gain.
 *
 * @module apps/api/src/sales-documents/http
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
 */
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DetectedMarketsResponseDto } from './dto/detected-market-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents')
export class SalesDocumentMarketsController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
  ) {}

  @Get('markets/detected')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Markets detected from ingested orders',
    description:
      'Distinct countries the operator has orders from over a fixed window, each with its order count, ' +
      'most orders first. The country is the one routing evaluates on, so configuring a market listed ' +
      'here changes what those orders get. Countries WITH configured routing are returned too - ' +
      'classification is the caller\'s job, which is what keeps this read and the configured-countries ' +
      'read from becoming two sources of truth. Read-only: it never creates a rule, a default or any ' +
      'routing, and a detected unconfigured market is a neutral state rather than a fault.',
  })
  @ApiResponse({ status: 200, description: 'Detected markets', type: DetectedMarketsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listDetectedMarkets(): Promise<DetectedMarketsResponseDto> {
    const discovery = await this.orderRecords.discoverSalesDocumentMarkets();
    return {
      windowDays: discovery.windowDays,
      since: discovery.since,
      markets: discovery.markets.map((market) => ({
        country: market.country,
        orderCount: market.orderCount,
      })),
    };
  }
}
