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
 *    converts each at today's rate. This is the finest native-currency
 *    breakdown available at THIS read model's granularity; a full per-order
 *    breakdown would need a new query and is out of scope here.
 *  - `'order-date'`: converts the already-aggregated revenue total in one
 *    shot, per `OrderDateConversionInput`'s own doc comment (which names
 *    `SalesAnalyticsHeadline.revenue` as its intended input).
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DISPLAY_CURRENCY_CONVERSION_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type ChannelSalesAnalytics,
  type DisplayCurrencyRateBasis,
  type IDisplayCurrencyConversionService,
  type IOrderRecordService,
  type NativeCurrencyAmount,
  type SalesAnalyticsHeadline,
} from '@openlinker/core/orders';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';
import {
  DisplayCurrencyConversionDto,
  SalesAnalyticsResponseDto,
} from './dto/sales-analytics-response.dto';

/** Shared shape of a headline/channel row's currency-bucket fields — the input to `buildDisplayCurrencyConversion`. */
interface CurrencyBucketRow {
  readonly currency: string | null;
  readonly revenue: number;
  readonly unconvertedCurrency: string | null;
  readonly unconvertedValue: number;
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
    private readonly displayCurrencyConversionService: IDisplayCurrencyConversionService
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
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_SALES_ANALYTICS_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_SALES_ANALYTICS_RANGE_DAYS}-day limit`
      );
    }

    const analytics = await this.orderRecordService.getSalesAndChannelAnalytics({
      from,
      to,
      sourceConnectionId: query.sourceConnectionId,
    });

    const dto = SalesAnalyticsResponseDto.fromDomain(analytics);

    // #2459: only touched when displayCurrency is present — an absent value
    // never reaches this branch, which is the byte-identical regression
    // guard for every pre-#2459 caller.
    if (query.displayCurrency !== undefined) {
      const rateBasis: DisplayCurrencyRateBasis = query.rateBasis ?? 'current-rate';
      dto.headline.displayCurrencyConversion = await this.buildDisplayCurrencyConversion(
        analytics.headline,
        query.displayCurrency,
        rateBasis
      );
      for (let i = 0; i < dto.channels.length; i += 1) {
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
   * the reporting-currency-stamped bucket (`currency`/`revenue`) and, when
   * present, the still-unconverted bucket (`unconvertedCurrency`/
   * `unconvertedValue`). This is the finest native-currency granularity
   * available at this read model — not a per-order breakdown.
   */
  private buildNativeCurrencyAmounts(row: CurrencyBucketRow): NativeCurrencyAmount[] {
    const amounts: NativeCurrencyAmount[] = [];
    if (row.currency !== null) {
      amounts.push({ currency: row.currency, amount: row.revenue });
    }
    if (row.unconvertedCurrency !== null) {
      amounts.push({ currency: row.unconvertedCurrency, amount: row.unconvertedValue });
    }
    return amounts;
  }
}
