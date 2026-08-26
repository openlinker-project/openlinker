/**
 * Analytics Coverage Controller
 *
 * HTTP surface for the `/analytics` Data Coverage panel (#2466, epic #2452
 * mini-epic #2463): `GET /analytics/coverage` elevates the currency
 * mismatch drill-down (#2464), the tax A/B/C split (#2465), and the new
 * product-matching-error detector into one response, one row per category.
 *
 * Single-context read — every detector lives in `orders` — so this injects
 * `IOrderRecordService` + `ITaxCoverageDetectionService` directly, mirroring
 * `SalesAnalyticsController`'s own reasoning (see its header) rather than
 * introducing an apps/api-layer composition service. The one cross-context
 * dependency, `IReportingCurrencySettingsService` (`@openlinker/core/currency`,
 * a leaf context), is resolved ONCE per request and threaded into both the
 * currency and tax reads so they can never straddle a setting change
 * mid-request — the same reasoning `OrderRecordService.
 * getSalesAndChannelAnalytics` documents for its own single resolve.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
  TaxCoverageCategoryValues,
  type IOrderRecordService,
  type ITaxCoverageDetectionService,
} from '@openlinker/core/orders';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { AnalyticsCoverageQueryDto } from './dto/analytics-coverage-query.dto';
import {
  AnalyticsCoverageResponseDto,
  CoverageCategoryRowDto,
} from './dto/analytics-coverage-response.dto';

/**
 * Sample size for `sampleOrderIds` — deliberately small. This endpoint's job
 * is to answer "is anything open, and roughly how much", not to serve a
 * paginated drill-down list — a future dedicated per-category endpoint is
 * the place for that, per the currency/tax detectors' own paginated reads.
 */
const COVERAGE_SAMPLE_SIZE = 10;

/** Mirrors `SalesAnalyticsController`'s own bound — see that controller for the rationale. */
const MAX_COVERAGE_RANGE_DAYS = 400;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsCoverageController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(TAX_COVERAGE_DETECTION_SERVICE_TOKEN)
    private readonly taxCoverageDetectionService: ITaxCoverageDetectionService,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService
  ) {}

  @Get('coverage')
  @ApiOperation({
    summary:
      'Data Coverage panel aggregate — one row per category (currency, tax A/B/C, product-matching)',
  })
  @ApiResponse({ status: 200, type: AnalyticsCoverageResponseDto })
  async getCoverage(
    @Query() query: AnalyticsCoverageQueryDto
  ): Promise<AnalyticsCoverageResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_COVERAGE_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_COVERAGE_RANGE_DAYS}-day limit`
      );
    }

    const salesFilters = { from, to, sourceConnectionId: query.sourceConnectionId };
    const healthFilters = {
      createdFrom: from,
      createdTo: to,
      sourceConnectionId: query.sourceConnectionId,
    };
    const pagination = { limit: COVERAGE_SAMPLE_SIZE, offset: 0 };

    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();

    const [currencyPage, taxPages, productMatchingPage] = await Promise.all([
      this.orderRecordService.getCurrencyMismatchOrders(
        salesFilters,
        currentReportingCurrency,
        pagination
      ),
      this.taxCoverageDetectionService.getAllCategoryPages(
        salesFilters,
        currentReportingCurrency,
        pagination
      ),
      this.orderRecordService.getProductMatchingErrorOrders(healthFilters, pagination),
    ]);

    const categories: CoverageCategoryRowDto[] = [
      CoverageCategoryRowDto.of(
        'currency',
        currencyPage.total,
        currencyPage.items.map((item) => item.internalOrderId)
      ),
      ...TaxCoverageCategoryValues.map((category) =>
        CoverageCategoryRowDto.of(
          category,
          taxPages[category].total,
          taxPages[category].items.map((item) => item.internalOrderId)
        )
      ),
      CoverageCategoryRowDto.of(
        'product-matching',
        productMatchingPage.total,
        productMatchingPage.items.map((item) => item.internalOrderId)
      ),
    ];

    const response = new AnalyticsCoverageResponseDto();
    response.categories = categories;
    return response;
  }
}
