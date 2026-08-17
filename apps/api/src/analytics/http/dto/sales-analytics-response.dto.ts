/**
 * Sales Analytics Response DTO
 *
 * Response body for `GET /analytics/sales` (#1987) — headline (all-channel)
 * revenue/orders/AOV/median/units figures plus a per-source-connection
 * breakdown with revenue share and a coverage-completeness signal.
 *
 * Currency-mixing detection and gross/net tax-treatment normalization are
 * deliberately out of scope here — see #2049/ADR-040 and a separate
 * tax-normalization effort.
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
