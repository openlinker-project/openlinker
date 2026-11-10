/**
 * Gift Report Controller (#3943)
 *
 * `GET /analytics/gifts` (the cost report), `.../bundles` (bundle sales and the
 * demand they put on components) and `.../export` (the per-customer CSV for the
 * accountant). Reads only. `@Roles('admin', 'operator', 'viewer')`, never
 * `@AnyRole()`: cost is commercial and must not reach `packer` (#2413).
 *
 * @module apps/api/src/analytics/http
 */
import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Query,
  type StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../integrations/application/interfaces/connection.service.interface';
import {
  GIFT_REPORT_API_SERVICE_TOKEN,
  type IGiftReportApiService,
} from '../application/services/gift-report-api.service.interface';
import {
  BundleReportResponseDto,
  GiftReportQueryDto,
  GiftReportRangeQueryDto,
  GiftReportResponseDto,
} from './dto/gift-report.dto';
import { loadConnectionLabels } from './connection-labels';
import { assertExportRange, csvDownload } from './export-range';
import { buildGiftCustomerCsv } from './gift-report-csv';
import { codedHttpError } from '../../common/errors/coded-http.exception';

/** Same bound as the margin reads: the report scans the orders in the range. */
const MAX_GIFT_REPORT_RANGE_DAYS = 400;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/gifts')
export class GiftReportController {
  constructor(
    @Inject(GIFT_REPORT_API_SERVICE_TOKEN) private readonly reports: IGiftReportApiService,
    @Inject(CONNECTION_SERVICE_TOKEN) private readonly connections: IConnectionService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({
    summary:
      'Gift cost: units, purchase cost and what the customer paid, per promotion and manual add',
    description:
      'Cancelled orders are excluded. Cost is net, in the order currency; a gift with no cost on file ' +
      'is counted in `unknownCostUnits` and is not in `costNet`. Totals are per currency.',
  })
  @ApiResponse({ status: 200, type: GiftReportResponseDto })
  getReport(@Query() query: GiftReportQueryDto): Promise<GiftReportResponseDto> {
    const { from, to } = parseRange(query);
    return this.reports.getReport({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
      giftSource: query.giftSource,
    });
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('bundles')
  @ApiOperation({ summary: 'Bundle sales and component demand over the same range' })
  @ApiResponse({ status: 200, type: BundleReportResponseDto })
  getBundles(@Query() query: GiftReportRangeQueryDto): Promise<BundleReportResponseDto> {
    const { from, to } = parseRange(query);
    return this.reports.getBundleReport({ from, to, sourceConnectionId: query.sourceConnectionId });
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('export')
  @ApiOperation({
    summary: 'Per-customer gift export (CSV) for the accountant',
    description:
      'One row per gift: date, resolved customer, gift, net purchase cost, document. Range capped at ' +
      '366 days. No yearly threshold is evaluated.',
  })
  async exportCsv(@Query() query: GiftReportQueryDto): Promise<StreamableFile> {
    // The coded export error must win over the screens' generic window cap.
    assertExportRange(new Date(query.from), new Date(query.to));
    const { from, to } = parseRange(query);
    const rows = await this.reports.getCustomerExportRows({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
      giftSource: query.giftSource,
    });
    const fromDay = from.toISOString().slice(0, 10);
    const toDay = new Date(to.getTime() - 1).toISOString().slice(0, 10);
    return csvDownload(
      buildGiftCustomerCsv({
        rows,
        labels: await loadConnectionLabels(this.connections),
        from,
        to,
      }),
      `openlinker_gifts-per-customer_${fromDay}_${toDay}.csv`
    );
  }
}

function parseRange(query: GiftReportRangeQueryDto): { from: Date; to: Date } {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (to.getTime() <= from.getTime()) {
    throw codedHttpError(
      HttpStatus.BAD_REQUEST,
      'GIFT_REPORT_RANGE_INVALID',
      'to must be after from',
      {
        rule: 'to-after-from',
      }
    );
  }
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_GIFT_REPORT_RANGE_DAYS) {
    throw codedHttpError(
      HttpStatus.BAD_REQUEST,
      'GIFT_REPORT_RANGE_INVALID',
      `Range too wide: ${Math.ceil(days)} days exceeds the ${MAX_GIFT_REPORT_RANGE_DAYS}-day limit`,
      { rule: 'too-wide' }
    );
  }
  return { from, to };
}
