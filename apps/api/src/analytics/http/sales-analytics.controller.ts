/**
 * Sales Analytics Controller
 *
 * HTTP surface for the `/analytics` KPI-strip / by-channel table (#1987):
 * revenue, orders, AOV, median, units — headline and per source connection.
 * Single-context read (entirely inside `orders`), so this injects
 * `IOrderRecordService` directly rather than introducing an apps/api-layer
 * composition service (unlike `NeedsAttentionService`, which exists
 * specifically to fan out across two core contexts). `IDisplayCurrencyConversionService`
 * (#2458) is the same-context sibling this controller wires in for #2459 —
 * still no cross-context composition service needed.
 *
 * Display-currency conversion (#2459) is called ONLY when `query.displayCurrency`
 * is present — an absent value takes zero extra code paths, which is the
 * regression guard for every existing caller. `rateBasis` selects which of
 * the two `IDisplayCurrencyConversionService` modes runs:
 *
 *  - `'current-rate'` (default): groups the two native-currency buckets this
 *    read model already tracks per row — the reporting-currency-stamped
 *    revenue bucket and, when present, the still-unconverted bucket — and
 *    converts the stamped one at today's rate. The unconverted bucket is
 *    REPORTED in the breakdown and deliberately NOT summed into the converted
 *    total (#2668 review, BLOCKING 1 — see `buildNativeCurrencyAmounts`).
 *    This is the finest native-currency breakdown available at THIS read
 *    model's granularity; a full per-order breakdown would need a new query
 *    and is out of scope here.
 *  - `'order-date'`: converts the already-aggregated revenue total in one
 *    shot, per `OrderDateConversionInput`'s own doc comment (which names
 *    `SalesAnalyticsHeadline.revenue` as its intended input).
 *
 * @module apps/api/src/analytics/http
 *
 * **The backfilled-tax-rate Net Sales opt-in is read PER REQUEST** (#2469).
 * `analytics_display_settings.include_backfilled_tax_rates_in_net_sales`
 * (#2461) is threaded into the core read as a plain boolean, because `orders`
 * must not import `analytics`. Reading it here, with no cache, is what makes
 * the acceptance criterion literal: toggling the setting changes the very next
 * query's result set, and toggling it back reverts it, without touching a
 * single `order_records` row.
 *
 * **`@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()` (#2413).**
 *
 * This route returns revenue, AOV, median order value and a per-channel
 * breakdown. #2413's owner enumerated buyer PII, fiscal documents and
 * connection configuration as surfaces the new `packer` role must not reach;
 * commercial analytics was not enumerated, and is added by that issue's route
 * review on the same rationale — if an invoice PDF is not packer-facing, the
 * company's revenue is not either, and the argument is stronger here, since an
 * invoice concerns one order and this concerns the business. Flagged in the
 * pull request rather than applied silently. Behaviourally identical for every
 * role that exists today, so re-admitting `packer` is one word.
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN,
  MIXED_NATIVE_CURRENCIES_LABEL,
  ORDER_RECORD_SERVICE_TOKEN,
  type ChannelSalesAnalytics,
  type DisplayCurrencyRateBasis,
  type IDisplayCurrencyConversionService,
  type IOrderRecordService,
  type NativeCurrencyAmount,
  type SalesAnalyticsHeadline,
} from '@openlinker/core/orders';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';
import {
  DisplayCurrencyConversionDto,
  SalesAnalyticsResponseDto,
} from './dto/sales-analytics-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';

/** Shared shape of a headline/channel row's currency-bucket fields — the input to `buildDisplayCurrencyConversion`. */
interface CurrencyBucketRow {
  readonly currency: string | null;
  readonly revenue: number;
  readonly orderCount: number;
  readonly unconvertedCurrency: string | null;
  readonly unconvertedValue: number;
  readonly unconvertedCount: number;
}

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
    private readonly orderRecordService: IOrderRecordService,
    @Inject(DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN)
    private readonly displayCurrencyConversionService: IDisplayCurrencyConversionService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService
  ) {}

  @Roles('admin', 'operator', 'viewer')
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

    // Read fresh on every request — see the class doc comment.
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();

    const analytics = await this.orderRecordService.getSalesAndChannelAnalytics(
      {
        from,
        to,
        sourceConnectionId: query.sourceConnectionId,
      },
      includeBackfilledTaxRatesInNetSales
    );

    const dto = SalesAnalyticsResponseDto.fromDomain(analytics);

    // #2459: only touched when displayCurrency is present — an absent value
    // never reaches this branch, which is the byte-identical regression
    // guard for every pre-#2459 caller.
    if (query.displayCurrency !== undefined) {
      const rateBasis: DisplayCurrencyRateBasis = query.rateBasis ?? 'current-rate';
      // SEQUENTIAL, and the headline first (#2668 review, finding 9) — this
      // reverses the `Promise.all` an earlier round introduced.
      //
      // Every row here resolves the SAME `(source, from, to, rateDate)` pair:
      // `resolveCurrentRateDate` is `now`-derived, and every channel's
      // `currency` is the one system-wide reporting currency. But
      // `ICurrencyRateService.getRateFor` is get-or-create against the
      // `exchange_rates` registry — it calls the provider "only if it is not
      // already registered" — so fanning the calls out does not share the
      // lookup, it races it: on the first request of the day a cold registry
      // meant N+1 concurrent NBP/ECB calls plus N+1 racing inserts against
      // `UQ` on `(source, from, to, rateDate)`. Awaiting the headline first
      // registers the row, and every channel after it reads that row instead.
      // This is also what `DisplayCurrencyConversionService`'s own inner loop
      // says it does, in as many words; the two halves now agree.
      dto.headline.displayCurrencyConversion = await this.buildDisplayCurrencyConversion(
        analytics.headline,
        query.displayCurrency,
        rateBasis
      );
      for (let i = 0; i < analytics.channels.length; i += 1) {
        dto.channels[i].displayCurrencyConversion = await this.buildDisplayCurrencyConversion(
          analytics.channels[i],
          query.displayCurrency,
          rateBasis
        );
      }
    }

    return dto;
  }

  /**
   * Dispatches to whichever `IDisplayCurrencyConversionService` mode
   * `rateBasis` names, over one row's currency-bucket fields — shared between
   * the headline and every channel row (`SalesAnalyticsHeadline` and
   * `ChannelSalesAnalytics` carry the same four fields this reads).
   */
  private async buildDisplayCurrencyConversion(
    row: SalesAnalyticsHeadline | ChannelSalesAnalytics,
    displayCurrency: string,
    rateBasis: DisplayCurrencyRateBasis
  ): Promise<DisplayCurrencyConversionDto> {
    if (rateBasis === 'order-date') {
      const result = await this.displayCurrencyConversionService.convertAtOrderDate({
        reportingTotal: row.revenue,
        reportingCurrency: row.currency,
        displayCurrency,
      });
      return DisplayCurrencyConversionDto.fromOrderDateResult(result, rateBasis);
    }

    const amounts: NativeCurrencyAmount[] = this.buildNativeCurrencyAmounts(row);
    const result = await this.displayCurrencyConversionService.convertAtCurrentRate({
      amounts,
      displayCurrency,
    });
    return DisplayCurrencyConversionDto.fromCurrentRateResult(result, rateBasis);
  }

  /**
   * The two native-currency buckets a headline/channel row actually tracks:
   * the reporting-currency-stamped bucket (`currency`/`revenue`/`orderCount`)
   * and, when present, the still-unconverted bucket (`unconvertedCurrency`/
   * `unconvertedValue`/`unconvertedCount`). This is the finest native-currency
   * granularity available at this read model — not a per-order breakdown.
   * Each bucket's real order count is threaded through via
   * `NativeCurrencyAmount.count` (#2488 review, IMPORTANT 1) so
   * `NativeCurrencyBreakdown.orderCount` reports true per-currency order
   * counts rather than "1 bucket = 1 order".
   *
   * When the unconverted set spans more than one native currency
   * (`unconvertedCurrency === null` with `unconvertedCount > 0` — #2488
   * review, IMPORTANT 2), that money is still reported, labelled with
   * {@link MIXED_NATIVE_CURRENCIES_LABEL} rather than silently dropped: this
   * read model doesn't retain which individual currencies made up that sum,
   * but it can and must still surface that unresolved money exists.
   *
   * **The unconverted bucket is REPORTED but never COUNTED** (#2668 review,
   * BLOCKING 1). It carries `excludedFromTotal: true`, so it appears in
   * `CurrentRateConversionResult.breakdown` and contributes nothing to
   * `convertedTotal` — the figure the KPI strip renders as GMV. Three
   * separate rules say it must not be in that number:
   * `architecture-overview.md § 4 Orders` and ADR-040 call the unstamped
   * slice "informational, may mix currencies — never a KPI — rather than
   * silently mixed in"; it is a shipping-INCLUSIVE `SUM(totalAmount)`, so
   * summing it partly undid #2892's move of GMV onto merchandise-only line
   * amounts as soon as a display currency was picked; and the KPI strip's own
   * "N orders not reflected in revenue" caveat was rendering over a number
   * that reflected them. It also restores headline GMV === Σ channel GMV,
   * since `channel-sales-table.tsx` converts via the per-bucket `appliedRate`
   * and never included this bucket.
   */
  private buildNativeCurrencyAmounts(row: CurrencyBucketRow): NativeCurrencyAmount[] {
    const amounts: NativeCurrencyAmount[] = [];
    if (row.currency !== null) {
      amounts.push({ currency: row.currency, amount: row.revenue, count: row.orderCount });
    }
    if (row.unconvertedCurrency !== null) {
      amounts.push({
        currency: row.unconvertedCurrency,
        amount: row.unconvertedValue,
        count: row.unconvertedCount,
        excludedFromTotal: true,
      });
    } else if (row.unconvertedCount > 0) {
      amounts.push({
        currency: MIXED_NATIVE_CURRENCIES_LABEL,
        amount: row.unconvertedValue,
        count: row.unconvertedCount,
        excludedFromTotal: true,
      });
    }
    return amounts;
  }
}
