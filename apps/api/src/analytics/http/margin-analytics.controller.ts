/**
 * Margin Analytics Controller
 *
 * HTTP surface for gross margin on NET revenue (#3588, D27, epic #3516):
 * headline / trend / per-channel (`GET /analytics/margin`), a ranked product
 * table (`.../products`) and a per-product variant drill-down
 * (`.../products/:productId/variants`). Amounts are VAT-exclusive in the system
 * reporting currency; a line counts toward margin only with a cost snapshotted
 * in the order's own currency (G11-C), and every other net-revenue line is
 * reported as a gap with a reason. Returned regardless of the `trackMargin`
 * display switch - that hides UI only.
 *
 * Same range cap and per-request `includeBackfilledTaxRatesInNetSales` read as
 * `SalesAnalyticsController` (see its header for the reasoning).
 *
 * `@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()`: commercial
 * analytics must not reach `packer` (#2413).
 *
 * @module apps/api/src/analytics/http
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  type StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  MARGIN_ANALYTICS_SERVICE_TOKEN,
  type IMarginAnalyticsService,
} from '@openlinker/core/orders';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  MarginAnalyticsQueryDto,
  MarginProductsQueryDto,
  MarginRangeQueryDto,
} from './dto/margin-analytics-query.dto';
import {
  MarginAnalyticsResponseDto,
  MarginProductsResponseDto,
  MarginProductVariantsResponseDto,
} from './dto/margin-analytics-response.dto';
import { assertExportRange, csvDownload, exportFilename } from './export-range';
import { loadConnectionLabels } from './connection-labels';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../integrations/application/interfaces/connection.service.interface';
import {
  buildMarginByChannelCsv,
  buildMarginByProductCsv,
  readAllMarginProducts,
} from './margin-analytics-csv';
import {
  MARGIN_ANALYTICS_API_SERVICE_TOKEN,
  type IMarginAnalyticsApiService,
} from '../application/services/margin-analytics-api.service.interface';

/** Mirrors `SalesAnalyticsController`'s bound - see that controller for the rationale. */
const MAX_MARGIN_RANGE_DAYS = 400;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/margin')
export class MarginAnalyticsController {
  constructor(
    @Inject(MARGIN_ANALYTICS_SERVICE_TOKEN)
    private readonly marginAnalytics: IMarginAnalyticsService,
    @Inject(MARGIN_ANALYTICS_API_SERVICE_TOKEN)
    private readonly marginApiService: IMarginAnalyticsApiService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService
  ) {}

  async getMargin(
    query: MarginAnalyticsQueryDto & { format?: 'json' }
  ): Promise<MarginAnalyticsResponseDto>;
  async getMargin(
    query: MarginAnalyticsQueryDto
  ): Promise<MarginAnalyticsResponseDto | StreamableFile>;
  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({
    summary:
      'Gross margin on net revenue for a date range - headline, trend and per source connection',
  })
  @ApiResponse({ status: 200, type: MarginAnalyticsResponseDto })
  async getMargin(
    @Query() query: MarginAnalyticsQueryDto
  ): Promise<MarginAnalyticsResponseDto | StreamableFile> {
    const isCsv = query.format === 'csv';
    const { from, to } = this.parseAndValidateRange(query, isCsv);
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    const analytics = await this.marginAnalytics.getMargin(
      { from, to, sourceConnectionId: query.sourceConnectionId },
      query.bucket ?? 'day',
      includeBackfilledTaxRatesInNetSales
    );
    const response = MarginAnalyticsResponseDto.fromDomain(analytics);
    if (isCsv) {
      return csvDownload(
        buildMarginByChannelCsv({
          analytics: response,
          from,
          to,
          labels: await loadConnectionLabels(this.connections),
        }),
        exportFilename({
          report: 'margin-by-channel',
          from,
          to,
          currency: response.currency,
          basis: 'net',
        })
      );
    }
    return response;
  }

  async getMarginProducts(
    query: MarginProductsQueryDto & { format?: 'json' }
  ): Promise<MarginProductsResponseDto>;
  async getMarginProducts(
    query: MarginProductsQueryDto
  ): Promise<MarginProductsResponseDto | StreamableFile>;
  @Roles('admin', 'operator', 'viewer')
  @Get('products')
  @ApiOperation({ summary: 'Products ranked by gross margin, net revenue or margin %' })
  @ApiResponse({ status: 200, type: MarginProductsResponseDto })
  async getMarginProducts(
    @Query() query: MarginProductsQueryDto
  ): Promise<MarginProductsResponseDto | StreamableFile> {
    const isCsv = query.format === 'csv';
    const { from, to } = this.parseAndValidateRange(query, isCsv);
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    if (isCsv) {
      // limit/offset are ignored: the file is the whole ranking, paged
      // internally through the same service call the JSON route uses.
      const { rows, currency } = await readAllMarginProducts(
        (filters) =>
          this.marginApiService.getMarginProducts(filters, includeBackfilledTaxRatesInNetSales),
        {
          from,
          to,
          sourceConnectionId: query.sourceConnectionId,
          sortBy: query.sortBy ?? 'grossMargin',
        }
      );
      const reporting = currency ?? 'unconverted';
      return csvDownload(
        buildMarginByProductCsv({ rows, currency: reporting, from, to }),
        exportFilename({ report: 'margin-by-product', from, to, currency: reporting, basis: 'net' })
      );
    }

    return this.marginApiService.getMarginProducts(
      {
        from,
        to,
        sourceConnectionId: query.sourceConnectionId,
        sortBy: query.sortBy ?? 'grossMargin',
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
      includeBackfilledTaxRatesInNetSales
    );
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('products/:productId/variants')
  @ApiParam({ name: 'productId', description: 'Internal product id' })
  @ApiOperation({
    summary: 'One product’s margin split by variant',
    description:
      'A variantId: null row is the lines that never resolved to a variant (gap reason no-variant).',
  })
  @ApiResponse({ status: 200, type: MarginProductVariantsResponseDto })
  async getMarginProductVariants(
    @Param('productId') productId: string,
    @Query() query: MarginRangeQueryDto
  ): Promise<MarginProductVariantsResponseDto> {
    const { from, to } = this.parseAndValidateRange(query);
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    return this.marginApiService.getMarginProductVariants(
      productId,
      { from, to, sourceConnectionId: query.sourceConnectionId },
      includeBackfilledTaxRatesInNetSales
    );
  }

  private parseAndValidateRange(
    query: MarginRangeQueryDto,
    isCsv = false
  ): { from: Date; to: Date } {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    // A CSV answers the coded export error for ANY too-wide range, so the
    // screens' generic window cap must not fire first (#3589).
    if (isCsv) {
      assertExportRange(from, to);
    }
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_MARGIN_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_MARGIN_RANGE_DAYS}-day limit`
      );
    }
    return { from, to };
  }
}
