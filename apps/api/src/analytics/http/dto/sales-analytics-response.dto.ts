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
 * for what's excluded. Gross/net tax-treatment normalization remains a
 * separate, not-yet-scoped effort.
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

  @ApiProperty()
  averageOrderValue!: number;

  @ApiProperty()
  medianOrderValue!: number;

  @ApiProperty()
  unitsSold!: number;

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

  @ApiProperty({ type: [DailyTrendPointDto] })
  trend!: DailyTrendPointDto[];

  static fromDomain(headline: SalesAnalyticsHeadline): SalesAnalyticsHeadlineDto {
    const dto = new SalesAnalyticsHeadlineDto();
    dto.revenue = headline.revenue;
    dto.orderCount = headline.orderCount;
    dto.averageOrderValue = headline.averageOrderValue;
    dto.medianOrderValue = headline.medianOrderValue;
    dto.unitsSold = headline.unitsSold;
    dto.cancelledCount = headline.cancelledCount;
    dto.cancelledValue = headline.cancelledValue;
    dto.currency = headline.currency;
    dto.unconvertedCount = headline.unconvertedCount;
    dto.unconvertedValue = headline.unconvertedValue;
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

  @ApiProperty()
  averageOrderValue!: number;

  @ApiProperty()
  unitsSold!: number;

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

  @ApiProperty({ description: 'Share of headline revenue, 0 when headline revenue is 0.' })
  revenueShare!: number;

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
    dto.cancelledCount = channel.cancelledCount;
    dto.cancelledValue = channel.cancelledValue;
    dto.currency = channel.currency;
    dto.unconvertedCount = channel.unconvertedCount;
    dto.unconvertedValue = channel.unconvertedValue;
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
