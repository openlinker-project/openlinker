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
 * `IAnalyticsRemediationRunService.getOpenRun` (#2475) is the fourth read in
 * the `Promise.all` below — cheap (a single indexed row lookup) and makes
 * the `'currency'` row's `status` honest about an in-flight repair. See
 * `CoverageCategoryRowDto`'s own header for why this is load-bearing rather
 * than cosmetic.
 *
 * `GET /analytics/coverage/by-connection` (#2713) is the aggregate-by-
 * connection sibling: `channel-sales-table.tsx`'s
 * `useCoverageCrossReferenceQuery` used to derive per-connection counts
 * client-side by paging through the full affected-order list; this endpoint
 * does the `GROUP BY sourceConnectionId` server-side instead. It reuses the
 * SAME query DTO and range validation as `getCoverage` (extracted into
 * {@link parseAndValidateRange}) and composes only the currency + tax A/B/C
 * aggregates — `product-matching` has no FE consumer to cross-reference
 * (confirmed: `channel-sales-table.tsx`'s own header states the
 * cross-reference is never done for that category), so it is deliberately
 * NOT included here.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
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
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
  CURRENCY_REMEDIATION_CATEGORY,
  type IAnalyticsDisplaySettingsService,
  type IAnalyticsRemediationRunService,
} from '@openlinker/core/analytics';
import { AnalyticsCoverageQueryDto } from './dto/analytics-coverage-query.dto';
import {
  AnalyticsCoverageResponseDto,
  CoverageCategoryRowDto,
} from './dto/analytics-coverage-response.dto';
import {
  AnalyticsCoverageByConnectionResponseDto,
  CoverageCategoryConnectionRowsDto,
} from './dto/analytics-coverage-by-connection-response.dto';

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
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService,
    @Inject(ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN)
    private readonly remediationRuns: IAnalyticsRemediationRunService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('coverage')
  @ApiOperation({
    summary:
      'Data Coverage panel aggregate — one row per category (currency, tax A/B/C, product-matching)',
  })
  @ApiResponse({ status: 200, type: AnalyticsCoverageResponseDto })
  async getCoverage(
    @Query() query: AnalyticsCoverageQueryDto
  ): Promise<AnalyticsCoverageResponseDto> {
    const { from, to } = this.parseAndValidateRange(query);

    const salesFilters = { from, to, sourceConnectionId: query.sourceConnectionId };
    const healthFilters = {
      createdFrom: from,
      createdTo: to,
      sourceConnectionId: query.sourceConnectionId,
    };
    const pagination = { limit: COVERAGE_SAMPLE_SIZE, offset: 0 };

    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
    // Threaded into the tax read for the same reason the currency is (#2469):
    // with the operator's opt-in ON a backfilled pre-rollout order is already
    // inside Net Sales, so reporting it as `tax-a` would claim outstanding work
    // on an order that has none.
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    const [currencyPage, taxPages, productMatchingPage, activeCurrencyRun] = await Promise.all([
      this.orderRecordService.getCurrencyMismatchOrders(
        salesFilters,
        currentReportingCurrency,
        pagination
      ),
      this.taxCoverageDetectionService.getAllCategoryPages(
        salesFilters,
        currentReportingCurrency,
        pagination,
        includeBackfilledTaxRatesInNetSales
      ),
      this.orderRecordService.getProductMatchingErrorOrders(healthFilters, pagination),
      this.remediationRuns.getOpenRun(CURRENCY_REMEDIATION_CATEGORY),
    ]);

    const categories: CoverageCategoryRowDto[] = [
      CoverageCategoryRowDto.of(
        'currency',
        currencyPage.total,
        currencyPage.items.map((item) => item.internalOrderId),
        activeCurrencyRun?.id ?? null
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

  @Roles('admin', 'operator', 'viewer')
  @Get('coverage/by-connection')
  @ApiOperation({
    summary:
      'Data Coverage panel, per-connection breakdown — affected-order counts grouped by sourceConnectionId (currency, tax A/B/C)',
  })
  @ApiResponse({ status: 200, type: AnalyticsCoverageByConnectionResponseDto })
  async getCoverageByConnection(
    @Query() query: AnalyticsCoverageQueryDto
  ): Promise<AnalyticsCoverageByConnectionResponseDto> {
    const { from, to } = this.parseAndValidateRange(query);

    const salesFilters = { from, to, sourceConnectionId: query.sourceConnectionId };

    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    const [currencyRows, taxRowsByCategory] = await Promise.all([
      this.orderRecordService.getCurrencyMismatchOrdersByConnection(
        salesFilters,
        currentReportingCurrency
      ),
      this.taxCoverageDetectionService.getAllCategoryCountsByConnection(
        salesFilters,
        currentReportingCurrency,
        includeBackfilledTaxRatesInNetSales
      ),
    ]);

    const response = new AnalyticsCoverageByConnectionResponseDto();
    response.categories = [
      CoverageCategoryConnectionRowsDto.of('currency', currencyRows),
      ...TaxCoverageCategoryValues.map((category) =>
        CoverageCategoryConnectionRowsDto.of(category, taxRowsByCategory[category])
      ),
    ];
    return response;
  }

  /**
   * Shared `from`/`to` parsing + `MAX_COVERAGE_RANGE_DAYS` validation for
   * every `/analytics/coverage*` route — extracted so `getCoverageByConnection`
   * (#2713) doesn't duplicate `getCoverage`'s validation block verbatim.
   * Behavior-preserving: same error messages, same 400 status.
   */
  private parseAndValidateRange(query: AnalyticsCoverageQueryDto): { from: Date; to: Date } {
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
    return { from, to };
  }
}
