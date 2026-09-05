/**
 * Analytics Tax Remediation Controller
 *
 * HTTP surface for the ONE tax-side Data Coverage action that does real work:
 * `POST /analytics/coverage/tax/rerun-backfill` (#2469, epic #2452 Phase 5).
 *
 * Deliberately separate from `AnalyticsRemediationController` (the currency
 * side), because the two are structurally different actions rather than two
 * variants of one:
 *
 *  - **No run ledger, no lifecycle, nothing to poll.** A backfill attempt is
 *    idempotent — it writes a rate only where the catalogue now HAS one and the
 *    line has none — so there is no state that can be left "in progress" and
 *    no reason to record an `analytics_remediation_runs` row. The Phase 1
 *    decision doc scopes that table to the currency category for exactly this
 *    reason.
 *  - **Synchronous.** It triggers the SAME resolution the scheduled
 *    `orders.taxRate.backfill` sweep already runs, just early, over a bounded
 *    set of orders the operator selected. Handing that to a job would add a
 *    poll surface to an action whose whole answer is "how many lines got a
 *    rate", available immediately.
 *
 * **There is no endpoint for tax category A or B, and that is correct.**
 * Category A's fix is a settings toggle (`PUT /analytics/settings`, #2462) that
 * this phase wired into the net-sales query — no data changes at all. Category
 * B genuinely has no resolvable rate anywhere, so an action would be a button
 * that cannot work; the mockup's `detail-novat` state shows the informational
 * row alone, and adding one here would promise a fix that does not exist.
 *
 * **`GET orders` (#2474, Phase 7) is the read-only exception to that "no
 * action" framing** — it lists, it does not act, so it backs all THREE
 * `detail-tax` / `detail-novat` / `detail-postrollout` modals (a `category`
 * query param selects which). Added alongside the FE Data Coverage panel
 * because the mockup requires real pagination in every detail modal, and
 * `ITaxCoverageDetectionService.getCategoryPage` already accepted a
 * `CoverageDetectionPagination` — the aggregate `GET /analytics/coverage`
 * only ever called `getAllCategoryPages` with a fixed 10-row sample, so
 * nothing exposed a caller-chosen page over HTTP until now. No `@Roles`
 * guard, mirroring `AnalyticsCoverageController.getCoverage` and
 * `AnalyticsRemediationController.getAffectedOrders` — a read of the same
 * shape the aggregate already serves to every authenticated user.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import {
  TAX_COVERAGE_DETECTION_SERVICE_TOKEN,
  TAX_RATE_BACKFILL_SERVICE_TOKEN,
  type ITaxCoverageDetectionService,
  type ITaxRateBackfillService,
} from '@openlinker/core/orders';
import { AnyRole } from '../../auth/decorators/any-role.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { TaxCoverageOrdersQueryDto } from './dto/tax-coverage-orders-query.dto';
import {
  TaxCoverageOrderDto,
  TaxCoverageOrdersResponseDto,
} from './dto/tax-coverage-orders-response.dto';
import {
  TaxRerunBackfillRequestDto,
  TaxRerunBackfillResponseDto,
} from './dto/tax-rerun-backfill.dto';

/** Mirrors `AnalyticsCoverageController`'s bound — see that controller. */
const MAX_COVERAGE_RANGE_DAYS = 400;

const DEFAULT_ORDERS_PAGE_SIZE = 25;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/coverage/tax')
export class AnalyticsTaxRemediationController {
  constructor(
    @Inject(TAX_RATE_BACKFILL_SERVICE_TOKEN)
    private readonly backfill: ITaxRateBackfillService,
    @Inject(TAX_COVERAGE_DETECTION_SERVICE_TOKEN)
    private readonly taxCoverageDetectionService: ITaxCoverageDetectionService,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService
  ) {}

  @Post('rerun-backfill')
  @Roles('admin')
  @ApiOperation({
    summary:
      "Re-resolve the named orders' tax rates from the current catalogue now, instead of waiting for the scheduled sweep",
  })
  @ApiResponse({ status: 201, type: TaxRerunBackfillResponseDto })
  async rerunBackfill(
    @Body() body: TaxRerunBackfillRequestDto
  ): Promise<TaxRerunBackfillResponseDto> {
    // Duplicates in the request are collapsed: the resolution is idempotent, so
    // a repeat is harmless, but counting the same line twice would report
    // `scanned`/`updated` figures the operator cannot reconcile with the list
    // they selected.
    const internalOrderIds = [...new Set(body.internalOrderIds)];
    const result = await this.backfill.backfillOrders(internalOrderIds);

    const dto = new TaxRerunBackfillResponseDto();
    dto.scanned = result.scanned;
    dto.updated = result.updated;
    return dto;
  }

  @AnyRole()
  @Get('orders')
  @ApiOperation({
    summary:
      'Paginated list of one tax A/B/C sub-category’s orders (detail-tax / detail-novat / detail-postrollout modals)',
  })
  @ApiResponse({ status: 200, type: TaxCoverageOrdersResponseDto })
  async getOrders(@Query() query: TaxCoverageOrdersQueryDto): Promise<TaxCoverageOrdersResponseDto> {
    const { from, to } = this.parseRange(query.from, query.to);
    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
    // Threaded the same way `AnalyticsCoverageController` does: with the
    // operator's opt-in ON, a backfilled pre-rollout order is net-eligible
    // and so no longer excluded at all — reporting it here would list an
    // order the panel's own aggregate no longer counts as outstanding.
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    const page = await this.taxCoverageDetectionService.getCategoryPage(
      query.category,
      { from, to, sourceConnectionId: query.sourceConnectionId },
      currentReportingCurrency,
      { limit: query.limit ?? DEFAULT_ORDERS_PAGE_SIZE, offset: query.offset ?? 0 },
      includeBackfilledTaxRatesInNetSales
    );

    const response = new TaxCoverageOrdersResponseDto();
    response.items = page.items.map((row) => TaxCoverageOrderDto.fromRow(row));
    response.total = page.total;
    return response;
  }

  /**
   * Shared range validation. Duplicated from `AnalyticsCoverageController` /
   * `AnalyticsRemediationController` rather than extracted — see either
   * controller's own comment on why a shared helper isn't worth it for three
   * lines of DTO-adjacent guard.
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
