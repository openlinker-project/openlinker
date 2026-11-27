/**
 * Margin Analytics Response DTOs
 *
 * Response bodies for `GET /analytics/margin*` (#3588, D27). All amounts are
 * net (VAT-exclusive) in `currency`, the system reporting currency. A
 * percentage is `null` when its denominator is 0 - never `0`.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  MarginBucketValues,
  MarginGapReasonValues,
  type MarginAnalytics,
  type MarginBucket,
  type MarginChannel,
  type MarginFigures,
  type MarginGapReason,
  type MarginGapSum,
  type MarginTrendPoint,
} from '@openlinker/core/orders';

export class MarginGapDto {
  @ApiProperty({ enum: MarginGapReasonValues })
  reason!: MarginGapReason;

  @ApiProperty({ description: 'Order lines in net revenue with this gap reason.' })
  lineCount!: number;

  @ApiProperty({ description: 'Net revenue of those lines (reporting currency).' })
  netAmount!: number;

  static fromDomain(gap: MarginGapSum): MarginGapDto {
    const dto = new MarginGapDto();
    dto.reason = gap.reason;
    dto.lineCount = gap.lineCount;
    dto.netAmount = gap.netAmount;
    return dto;
  }
}

export class MarginFigDto {
  @ApiProperty({
    description: 'Net (VAT-exclusive) revenue, same population as top-products net revenue.',
  })
  netRevenue!: number;

  @ApiProperty({
    description: 'Net revenue of lines with a recorded cost in the order’s own currency.',
  })
  coveredNetRevenue!: number;

  @ApiProperty({
    description: 'Unit cost x quantity over covered lines, in the reporting currency.',
  })
  costOfGoods!: number;

  @ApiProperty({ description: 'coveredNetRevenue - costOfGoods.' })
  grossMargin!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'grossMargin / coveredNetRevenue; null when nothing is covered.',
  })
  marginPct!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'coveredNetRevenue / netRevenue; null when there is no net revenue.',
  })
  costCoveragePct!: number | null;

  @ApiProperty({
    type: [MarginGapDto],
    description: 'Always all four reasons. coveredNetRevenue + sum(gaps.netAmount) = netRevenue.',
  })
  gaps!: MarginGapDto[];

  assignFigures(figures: MarginFigures): void {
    this.netRevenue = figures.netRevenue;
    this.coveredNetRevenue = figures.coveredNetRevenue;
    this.costOfGoods = figures.costOfGoods;
    this.grossMargin = figures.grossMargin;
    this.marginPct = figures.marginPct;
    this.costCoveragePct = figures.costCoveragePct;
    this.gaps = figures.gaps.map((gap) => MarginGapDto.fromDomain(gap));
  }

  static fromFigures(figures: MarginFigures): MarginFigDto {
    const dto = new MarginFigDto();
    dto.assignFigures(figures);
    return dto;
  }
}

export class MarginTrendPointDto extends MarginFigDto {
  @ApiProperty({
    description: 'First covered UTC day of the bucket, YYYY-MM-DD (the ISO Monday for week).',
  })
  date!: string;

  static fromDomain(point: MarginTrendPoint): MarginTrendPointDto {
    const dto = new MarginTrendPointDto();
    dto.assignFigures(point);
    dto.date = point.date;
    return dto;
  }
}

export class MarginChannelDto extends MarginFigDto {
  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Share of the headline net revenue, 0..1.',
  })
  revenueShare!: number | null;

  static fromDomain(channel: MarginChannel): MarginChannelDto {
    const dto = new MarginChannelDto();
    dto.assignFigures(channel);
    dto.sourceConnectionId = channel.sourceConnectionId;
    dto.revenueShare = channel.revenueShare;
    return dto;
  }
}

export class MarginAnalyticsResponseDto {
  @ApiProperty({ description: 'Reporting currency every amount is expressed in.' })
  currency!: string;

  @ApiProperty({ enum: MarginBucketValues })
  bucket!: MarginBucket;

  @ApiProperty({ type: MarginFigDto })
  headline!: MarginFigDto;

  @ApiProperty({ type: [MarginTrendPointDto] })
  trend!: MarginTrendPointDto[];

  @ApiProperty({ type: [MarginChannelDto] })
  channels!: MarginChannelDto[];

  @ApiProperty({
    description:
      'In-scope lines left out of net revenue altogether (unstamped, zero total, net-ineligible).',
  })
  excludedLineCount!: number;

  static fromDomain(analytics: MarginAnalytics): MarginAnalyticsResponseDto {
    const dto = new MarginAnalyticsResponseDto();
    dto.currency = analytics.currency;
    dto.bucket = analytics.bucket;
    dto.headline = MarginFigDto.fromFigures(analytics.headline);
    dto.trend = analytics.trend.map((point) => MarginTrendPointDto.fromDomain(point));
    dto.channels = analytics.channels.map((channel) => MarginChannelDto.fromDomain(channel));
    dto.excludedLineCount = analytics.excludedLineCount;
    return dto;
  }
}

export class MarginProductRowDto extends MarginFigDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;
}

export class MarginProductsResponseDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: [MarginProductRowDto] })
  items!: MarginProductRowDto[];

  @ApiProperty({ description: 'Distinct products in scope before paging.' })
  total!: number;

  @ApiProperty({
    description: 'Rows whose product no longer resolves in the catalogue (name/sku are null).',
  })
  unresolvedProductCount!: number;
}

export class MarginVariantRowDto extends MarginFigDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null = lines that never resolved to a variant.',
  })
  variantId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, nullable: true })
  attributes!: Record<string, string> | null;
}

export class MarginProductVariantsResponseDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ type: [MarginVariantRowDto] })
  variants!: MarginVariantRowDto[];
}
