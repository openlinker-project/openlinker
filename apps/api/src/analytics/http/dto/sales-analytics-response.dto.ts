/**
 * Sales Analytics Response DTO
 *
 * Response body for `GET /analytics/sales` (#1987) — headline (all-channel)
 * revenue/orders/AOV/median/units figures plus a per-source-connection
 * breakdown with revenue share and a coverage-completeness signal.
 *
 * Currency correctness (#2049/ADR-040 follow-up): `revenue`/`averageOrderValue`/
 * `medianOrderValue` are computed only from reporting-currency-stamped orders
 * — see `currency` for which one, and `unconvertedCount`/`unconvertedValue`
 * for what's excluded. `unconvertedCurrency` labels that excluded figure with
 * its own native currency (#1987 scope — `order_records.currency` predates
 * the FX epic), `null` when the unconverted set itself mixes currencies.
 * Gross/net tax-treatment normalization remains a separate, not-yet-scoped
 * effort.
 *
 * Display-currency conversion (#2459, ADR-064): `displayCurrencyConversion` is
 * `undefined` unless the request carried `displayCurrency` — that's the
 * regression guard for every pre-#2459 caller. When present, it's populated
 * on the headline and on every channel row, using whichever of the two
 * `IDisplayCurrencyConversionService` modes the request's `rateBasis` named.
 *
 * Rate provenance (#2778): `appliedRates` carries what produced each
 * converted figure — see `AppliedRateDto`.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisplayCurrencyRateBasis } from '@openlinker/core/orders';
import type {
  AppliedRate,
  ChannelSalesAnalytics,
  CurrentRateConversionResult,
  DailyTrendPoint,
  OrderDateConversionResult,
  SalesAnalyticsHeadline,
  SalesAndChannelAnalytics,
} from '@openlinker/core/orders';

/**
 * What produced one converted figure (#2778) — the wire projection of the
 * domain `AppliedRate`. Never a statutory rate; see ADR-040's own warning
 * about the FA(3) `KursWaluty` distinction.
 */
export class AppliedRateDto {
  @ApiProperty({ description: 'The native currency this rate converts FROM (ISO-4217).' })
  from!: string;

  @ApiProperty({ description: 'The currency this rate converts TO (ISO-4217).' })
  to!: string;

  @ApiProperty({
    type: String,
    description:
      'to units per one from unit, as a string — never Number()’d, matching the ' +
      'numeric(18,8) registry column this figure is audited against. ' +
      'Analytics provenance only; never a statutory/fiscal conversion rate (ADR-040).',
  })
  rate!: string;

  @ApiProperty({ description: 'The day the source published this rate for, ISO YYYY-MM-DD.' })
  rateDate!: string;

  @ApiProperty({ description: "Which publisher this rate came from, e.g. 'nbp' or 'ecb'." })
  source!: string;

  @ApiProperty({
    enum: ['direct', 'inverted', 'pivot'],
    description: 'How the stored rate was obtained from the source’s own published quotes.',
  })
  derivation!: 'direct' | 'inverted' | 'pivot';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The source's own document reference (e.g. NBP's table number 149/A/NBP/2026), " +
      'or null — ECB assigns none.',
  })
  sourceRef!: string | null;

  static fromDomain(rate: AppliedRate): AppliedRateDto {
    const dto = new AppliedRateDto();
    dto.from = rate.from;
    dto.to = rate.to;
    dto.rate = rate.rate;
    dto.rateDate = rate.rateDate;
    dto.source = rate.source;
    dto.derivation = rate.derivation;
    dto.sourceRef = rate.sourceRef;
    return dto;
  }
}

/**
 * The uniform shape both `IDisplayCurrencyConversionService` modes project
 * into. `unresolvedNativeCurrencies` is always an array — for `order-date`
 * (whose domain result carries a single `unresolved` boolean plus one
 * `sourceCurrency`) that's normalised to a 0- or 1-element list, so a caller
 * reads one field regardless of which `rateBasis` was requested.
 */
export class DisplayCurrencyConversionDto {
  @ApiProperty({ description: 'The requested target currency (ISO-4217).' })
  displayCurrency!: string;

  @ApiProperty({ description: 'Which conversion mode produced this result.' })
  rateBasis!: DisplayCurrencyRateBasis;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The converted revenue figure, or null when there was nothing to convert ' +
      "('order-date' with no stamped order in range yet).",
  })
  convertedRevenue!: number | null;

  @ApiProperty({
    type: [String],
    description:
      'Native currencies that could not be converted (no resolvable rate) and were excluded ' +
      "from convertedRevenue — never guessed at. May also contain the literal 'mixed-currencies' " +
      'when the still-unconverted bucket itself spans more than one native currency — that money ' +
      'is real and non-zero but this read model has no single ISO code to label it with, so it is ' +
      'reported here rather than silently dropped. Empty when every bucket converted cleanly.',
  })
  unresolvedNativeCurrencies!: string[];

  @ApiProperty({
    type: [AppliedRateDto],
    description:
      'What produced each converted figure (#2778). For current-rate, one entry per resolved ' +
      "native-currency row (never for an identity or an unresolved row). For order-date, 0- or " +
      "1-element — the same normalisation unresolvedNativeCurrencies already uses for that mode.",
  })
  appliedRates!: AppliedRateDto[];

  static fromCurrentRateResult(
    result: CurrentRateConversionResult,
    rateBasis: DisplayCurrencyRateBasis
  ): DisplayCurrencyConversionDto {
    const dto = new DisplayCurrencyConversionDto();
    dto.displayCurrency = result.displayCurrency;
    dto.rateBasis = rateBasis;
    dto.convertedRevenue = result.convertedTotal;
    dto.unresolvedNativeCurrencies = [...result.unresolvedNativeCurrencies];
    dto.appliedRates = result.breakdown
      .filter((row) => row.appliedRate !== null)
      .map((row) => AppliedRateDto.fromDomain(row.appliedRate as AppliedRate));
    return dto;
  }

  static fromOrderDateResult(
    result: OrderDateConversionResult,
    rateBasis: DisplayCurrencyRateBasis
  ): DisplayCurrencyConversionDto {
    const dto = new DisplayCurrencyConversionDto();
    dto.displayCurrency = result.displayCurrency;
    dto.rateBasis = rateBasis;
    dto.convertedRevenue = result.convertedTotal;
    dto.appliedRates =
      result.appliedRate !== null ? [AppliedRateDto.fromDomain(result.appliedRate)] : [];
    dto.unresolvedNativeCurrencies =
      result.unresolved && result.sourceCurrency !== null ? [result.sourceCurrency] : [];
    return dto;
  }
}

export class DailyTrendPointDto {
  @ApiProperty({ description: 'yyyy-mm-dd' })
  date!: string;

  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  orderCount!: number;

  static fromDomain(point: DailyTrendPoint): DailyTrendPointDto {
    const dto = new DailyTrendPointDto();
    dto.date = point.date;
    dto.revenue = point.revenue;
    dto.orderCount = point.orderCount;
    return dto;
  }
}

export class SalesAnalyticsHeadlineDto {
  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  orderCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'null when orderCount is 0 (distinct from a genuine zero AOV).',
  })
  averageOrderValue!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'null when no stamped order matches the range (distinct from a genuine zero median).',
  })
  medianOrderValue!: number | null;

  @ApiProperty({
    description: 'Units sold on the same current-era-stamped orders orderCount/revenue count.',
  })
  unitsSold!: number;

  @ApiProperty({
    description:
      'Units sold on unconvertedCount orders — the unitsSold companion to unconvertedValue.',
  })
  unconvertedUnitsSold!: number;

  @ApiProperty({
    description: 'All cancelled orders in range, regardless of FX-stamp state.',
  })
  cancelledCount!: number;

  @ApiProperty({
    description:
      'VAT-exclusive, shipping-excluded value of current-era-stamped, cancelled orders — expressed in currency. Excludes a cancelled order carrying any line with an unresolvable tax rate — see cancelledNetExcludedCount/cancelledNetExcludedValue for what was excluded, and cancelledUnconvertedValue for what is currency-unstamped.',
  })
  cancelledValue!: number;

  @ApiProperty({
    description:
      'Cancelled orders in range with no current-era reporting-currency stamp — not reflected in cancelledValue.',
  })
  cancelledUnconvertedCount!: number;

  @ApiProperty({
    description:
      'Native-currency sum for cancelledUnconvertedCount. Informational only — may mix currencies.',
  })
  cancelledUnconvertedValue!: number;

  @ApiProperty({
    description:
      'Current-era-stamped, cancelled orders in range excluded from cancelledValue — carrying at least one line with an unresolvable tax rate.',
  })
  cancelledNetExcludedCount!: number;

  @ApiProperty({
    description:
      'Native-currency sum for cancelledNetExcludedCount — informational only, may mix currencies.',
  })
  cancelledNetExcludedValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Reporting currency revenue/averageOrderValue/medianOrderValue/cancelledValue are expressed in. Null when no order in range has been stamped yet.',
  })
  currency!: string | null;

  @ApiProperty({
    description:
      'Non-cancelled orders in range with no reporting-currency stamp yet — not reflected in revenue.',
  })
  unconvertedCount!: number;

  @ApiProperty({
    description:
      'Native-currency sum for unconvertedCount. Informational only — may mix currencies.',
  })
  unconvertedValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The one native currency unconvertedValue is expressed in. Null when the unconverted set spans more than one native currency (or unconvertedCount is 0).',
  })
  unconvertedCurrency!: string | null;

  @ApiProperty({ type: [DailyTrendPointDto] })
  trend!: DailyTrendPointDto[];

  @ApiProperty({
    description:
      'VAT-exclusive counterpart of revenue (net-sales tax-rate epic). Excludes an order that predates per-line tax rates or carries any line with an unresolvable rate — see netExcludedCount/netExcludedValue for what was excluded. Still gross of returns/refunds, which are not modeled — this is not yet the fully-netted "Net Sales" figure the metrics spec defines.',
  })
  netRevenue!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'netRevenue divided by the net-eligible order count (orderCount minus netExcludedCount). null when that count is 0.',
  })
  netAverageOrderValue!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'VAT-exclusive counterpart of medianOrderValue. null when no net-eligible order matches the range.',
  })
  netMedianOrderValue!: number | null;

  @ApiProperty({
    description:
      'Orders in range excluded from netRevenue — pre-rollout history (no tax rate was ever collected) or carrying at least one line with an unresolvable tax rate. Disjoint from unconvertedCount, which is a currency-stamp exclusion, not a tax-rate one.',
  })
  netExcludedCount!: number;

  @ApiProperty({
    description:
      'Native-currency sum for netExcludedCount — informational only, may mix currencies.',
  })
  netExcludedValue!: number;

  @ApiPropertyOptional({
    type: DisplayCurrencyConversionDto,
    description:
      'Present only when the request carried displayCurrency (#2459). Absent — never null — ' +
      'when the request omitted it, which is what keeps the response byte-identical to a ' +
      'pre-#2459 caller.',
  })
  displayCurrencyConversion?: DisplayCurrencyConversionDto;

  static fromDomain(headline: SalesAnalyticsHeadline): SalesAnalyticsHeadlineDto {
    const dto = new SalesAnalyticsHeadlineDto();
    dto.revenue = headline.revenue;
    dto.orderCount = headline.orderCount;
    dto.averageOrderValue = headline.averageOrderValue;
    dto.medianOrderValue = headline.medianOrderValue;
    dto.unitsSold = headline.unitsSold;
    dto.unconvertedUnitsSold = headline.unconvertedUnitsSold;
    dto.cancelledCount = headline.cancelledCount;
    dto.cancelledValue = headline.cancelledValue;
    dto.cancelledUnconvertedCount = headline.cancelledUnconvertedCount;
    dto.cancelledUnconvertedValue = headline.cancelledUnconvertedValue;
    dto.cancelledNetExcludedCount = headline.cancelledNetExcludedCount;
    dto.cancelledNetExcludedValue = headline.cancelledNetExcludedValue;
    dto.currency = headline.currency;
    dto.unconvertedCount = headline.unconvertedCount;
    dto.unconvertedValue = headline.unconvertedValue;
    dto.unconvertedCurrency = headline.unconvertedCurrency;
    dto.trend = headline.trend.map((point) => DailyTrendPointDto.fromDomain(point));
    dto.netRevenue = headline.netRevenue;
    dto.netAverageOrderValue = headline.netAverageOrderValue;
    dto.netMedianOrderValue = headline.netMedianOrderValue;
    dto.netExcludedCount = headline.netExcludedCount;
    dto.netExcludedValue = headline.netExcludedValue;
    return dto;
  }
}

export class ChannelSalesAnalyticsDto {
  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  orderCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Same meaning as the headline averageOrderValue field — null when orderCount is 0.',
  })
  averageOrderValue!: number | null;

  @ApiProperty()
  unitsSold!: number;

  @ApiProperty({
    description: 'Same meaning as the headline unconvertedUnitsSold field, scoped to this channel.',
  })
  unconvertedUnitsSold!: number;

  @ApiProperty({
    description: 'Same meaning as the headline cancelledCount field, scoped to this channel.',
  })
  cancelledCount!: number;

  @ApiProperty({
    description: 'Same meaning as the headline cancelledValue field, scoped to this channel.',
  })
  cancelledValue!: number;

  @ApiProperty({
    description:
      'Same meaning as the headline cancelledUnconvertedCount field, scoped to this channel.',
  })
  cancelledUnconvertedCount!: number;

  @ApiProperty({
    description:
      'Same meaning as the headline cancelledUnconvertedValue field, scoped to this channel.',
  })
  cancelledUnconvertedValue!: number;

  @ApiProperty({
    description:
      'Same meaning as the headline cancelledNetExcludedCount field, scoped to this channel.',
  })
  cancelledNetExcludedCount!: number;

  @ApiProperty({
    description:
      'Same meaning as the headline cancelledNetExcludedValue field, scoped to this channel.',
  })
  cancelledNetExcludedValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Same meaning as the headline currency field, scoped to this channel.',
  })
  currency!: string | null;

  @ApiProperty({
    description: 'Same meaning as the headline unconvertedCount field, scoped to this channel.',
  })
  unconvertedCount!: number;

  @ApiProperty({
    description: 'Same meaning as the headline unconvertedValue field, scoped to this channel.',
  })
  unconvertedValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Same meaning as the headline unconvertedCurrency field, scoped to this channel.',
  })
  unconvertedCurrency!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Share of headline revenue, null when headline revenue is 0.',
  })
  revenueShare!: number | null;

  @ApiProperty({ type: [DailyTrendPointDto] })
  trend!: DailyTrendPointDto[];

  @ApiProperty({
    description:
      "False when this channel's oldest ingested order postdates the requested range start.",
  })
  coverageComplete!: boolean;

  @ApiProperty({
    description: 'Same meaning as the headline netRevenue field, scoped to this channel.',
  })
  netRevenue!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Same meaning as the headline netAverageOrderValue field, scoped to this channel.',
  })
  netAverageOrderValue!: number | null;

  @ApiProperty({
    description: 'Same meaning as the headline netExcludedCount field, scoped to this channel.',
  })
  netExcludedCount!: number;

  @ApiProperty({
    description: 'Same meaning as the headline netExcludedValue field, scoped to this channel.',
  })
  netExcludedValue!: number;

  @ApiPropertyOptional({
    type: DisplayCurrencyConversionDto,
    description:
      'Same meaning as the headline displayCurrencyConversion field, scoped to this channel.',
  })
  displayCurrencyConversion?: DisplayCurrencyConversionDto;

  static fromDomain(channel: ChannelSalesAnalytics): ChannelSalesAnalyticsDto {
    const dto = new ChannelSalesAnalyticsDto();
    dto.sourceConnectionId = channel.sourceConnectionId;
    dto.revenue = channel.revenue;
    dto.orderCount = channel.orderCount;
    dto.averageOrderValue = channel.averageOrderValue;
    dto.unitsSold = channel.unitsSold;
    dto.unconvertedUnitsSold = channel.unconvertedUnitsSold;
    dto.cancelledCount = channel.cancelledCount;
    dto.cancelledValue = channel.cancelledValue;
    dto.cancelledUnconvertedCount = channel.cancelledUnconvertedCount;
    dto.cancelledUnconvertedValue = channel.cancelledUnconvertedValue;
    dto.cancelledNetExcludedCount = channel.cancelledNetExcludedCount;
    dto.cancelledNetExcludedValue = channel.cancelledNetExcludedValue;
    dto.currency = channel.currency;
    dto.unconvertedCount = channel.unconvertedCount;
    dto.unconvertedValue = channel.unconvertedValue;
    dto.unconvertedCurrency = channel.unconvertedCurrency;
    dto.revenueShare = channel.revenueShare;
    dto.trend = channel.trend.map((point) => DailyTrendPointDto.fromDomain(point));
    dto.coverageComplete = channel.coverageComplete;
    dto.netRevenue = channel.netRevenue;
    dto.netAverageOrderValue = channel.netAverageOrderValue;
    dto.netExcludedCount = channel.netExcludedCount;
    dto.netExcludedValue = channel.netExcludedValue;
    return dto;
  }
}

export class SalesAnalyticsResponseDto {
  @ApiProperty({ type: SalesAnalyticsHeadlineDto })
  headline!: SalesAnalyticsHeadlineDto;

  @ApiProperty({ type: [ChannelSalesAnalyticsDto] })
  channels!: ChannelSalesAnalyticsDto[];

  static fromDomain(analytics: SalesAndChannelAnalytics): SalesAnalyticsResponseDto {
    const dto = new SalesAnalyticsResponseDto();
    dto.headline = SalesAnalyticsHeadlineDto.fromDomain(analytics.headline);
    dto.channels = analytics.channels.map((channel) =>
      ChannelSalesAnalyticsDto.fromDomain(channel)
    );
    return dto;
  }
}
