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
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type {
  ChannelSalesAnalytics,
  DailyTrendPoint,
  SalesAnalyticsHeadline,
  SalesAndChannelAnalytics,
} from '@openlinker/core/orders';

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
    description: 'Units sold on unconvertedCount orders — the unitsSold companion to unconvertedValue.',
  })
  unconvertedUnitsSold!: number;

  @ApiProperty()
  cancelledCount!: number;

  @ApiProperty()
  cancelledValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Reporting currency revenue/averageOrderValue/medianOrderValue are expressed in. Null when no order in range has been stamped yet.',
  })
  currency!: string | null;

  @ApiProperty({
    description:
      "Non-cancelled orders in range with no reporting-currency stamp yet — not reflected in revenue.",
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
    dto.currency = headline.currency;
    dto.unconvertedCount = headline.unconvertedCount;
    dto.unconvertedValue = headline.unconvertedValue;
    dto.unconvertedCurrency = headline.unconvertedCurrency;
    dto.trend = headline.trend.map((point) => DailyTrendPointDto.fromDomain(point));
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
    description: 'Same meaning as the headline averageOrderValue field — null when orderCount is 0.',
  })
  averageOrderValue!: number | null;

  @ApiProperty()
  unitsSold!: number;

  @ApiProperty({
    description: 'Same meaning as the headline unconvertedUnitsSold field, scoped to this channel.',
  })
  unconvertedUnitsSold!: number;

  @ApiProperty()
  cancelledCount!: number;

  @ApiProperty()
  cancelledValue!: number;

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
    dto.currency = channel.currency;
    dto.unconvertedCount = channel.unconvertedCount;
    dto.unconvertedValue = channel.unconvertedValue;
    dto.unconvertedCurrency = channel.unconvertedCurrency;
    dto.revenueShare = channel.revenueShare;
    dto.trend = channel.trend.map((point) => DailyTrendPointDto.fromDomain(point));
    dto.coverageComplete = channel.coverageComplete;
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
    dto.channels = analytics.channels.map((channel) => ChannelSalesAnalyticsDto.fromDomain(channel));
    return dto;
  }
}
