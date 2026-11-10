/**
 * Gift Report DTOs (#3943)
 *
 * Query and response shapes of `GET /analytics/gifts*`. Amounts are VAT-exclusive
 * (cost) or gross (what the customer paid) in the ORDER's currency; the report
 * never converts, so every total is split per currency. A cost the catalogue
 * does not hold is `null` and its units are counted separately, never as zero.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { GiftReportSourceFilterValues, type GiftReportSourceFilter } from '@openlinker/core/orders';

export class GiftReportRangeQueryDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601), by order placed date.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601), by order placed date.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to one source connection (channel)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}

export class GiftReportQueryDto extends GiftReportRangeQueryDto {
  @ApiPropertyOptional({
    enum: GiftReportSourceFilterValues,
    description: '`rule` = given by a promotion, `manual` = added by hand. Omit for both.',
  })
  @IsOptional()
  @IsIn(GiftReportSourceFilterValues)
  giftSource?: GiftReportSourceFilter;
}

export class GiftReportGroupDto {
  @ApiProperty() key!: string;
  @ApiProperty({ enum: ['channel', 'cart-rule', 'ol-rule', 'operator', 'bundle'] })
  giftSource!: string;
  @ApiProperty({ nullable: true, description: 'The promotion id, when a rule gave it.' })
  ruleRef!: string | null;
  @ApiProperty({ nullable: true, description: 'The promotion name; null for a deleted rule or a non-rule gift.' })
  ruleName!: string | null;
  @ApiProperty() productId!: string;
  @ApiProperty({ nullable: true }) variantId!: string | null;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty() units!: number;
  @ApiProperty() orders!: number;
  @ApiProperty({ description: 'Gross, what customers paid for the gift units (0 for a free gift).' })
  paidGross!: number;
  @ApiProperty({ description: 'Net purchase cost of the units whose cost is known.' })
  costNet!: number;
  @ApiProperty({ description: 'Units with no cost on file; they are NOT in costNet.' })
  unknownCostUnits!: number;
  @ApiProperty({
    type: [String],
    description: 'The channels (source connection ids) that sent the orders carrying this gift.',
  })
  sourceConnectionIds!: string[];
}

export class GiftReportTotalsDto {
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty({ description: 'Distinct orders carrying at least one gift.' }) orders!: number;
  @ApiProperty() units!: number;
  @ApiProperty() paidGross!: number;
  @ApiProperty() costNet!: number;
  @ApiProperty() unknownCostUnits!: number;
}

export class GiftCostPointDto {
  @ApiProperty({ description: 'Start of the bucket, ISO 8601.' }) start!: string;
  @ApiProperty({ description: 'Net purchase cost of the units whose cost is known.' }) costNet!: number;
  @ApiProperty() units!: number;
  @ApiProperty() unknownCostUnits!: number;
  @ApiProperty({ description: 'The bucket runs past the end of the range.' }) partial!: boolean;
}

export class GiftCostSeriesDto {
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty({ enum: ['day', 'week'] }) granularity!: string;
  @ApiProperty({ type: [GiftCostPointDto] }) points!: GiftCostPointDto[];
}

export class GiftReportResponseDto {
  @ApiProperty({ type: [GiftReportGroupDto] }) groups!: GiftReportGroupDto[];
  @ApiProperty({ type: [GiftReportTotalsDto], description: 'One per currency; never added across currencies.' })
  totals!: GiftReportTotalsDto[];
  @ApiProperty({
    type: [GiftCostSeriesDto],
    description: 'Cost over time, one series per currency; weekly for ranges over eight days.',
  })
  series!: GiftCostSeriesDto[];
}

export class BundleReportComponentDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty() units!: number;
  @ApiProperty({ nullable: true }) unitCostNet!: number | null;
  @ApiProperty({ nullable: true }) costNet!: number | null;
  @ApiProperty() giftSlot!: boolean;
}

export class BundleReportRowDto {
  @ApiProperty() bundleVariantId!: string;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty() unitsSold!: number;
  @ApiProperty({ nullable: true }) revenueNet!: number | null;
  @ApiProperty({ nullable: true }) costNet!: number | null;
  @ApiProperty() componentCostMissing!: boolean;
  @ApiProperty() hasGiftSlot!: boolean;
  @ApiProperty({ nullable: true }) marginNet!: number | null;
  @ApiProperty({ description: 'Purchase cost of the components given free; known costs only.' })
  giftCostNet!: number;
  @ApiProperty({ type: [BundleReportComponentDto] }) components!: BundleReportComponentDto[];
}

export class BundleDemandRowDto {
  @ApiProperty() variantId!: string;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty() inBundles!: number;
  @ApiProperty() alone!: number;
  @ApiProperty({ nullable: true, description: 'Units OpenLinker would promise now; null when unknown.' })
  available!: number | null;
}

export class BundleReportResponseDto {
  @ApiProperty({ type: [BundleReportRowDto] }) bundles!: BundleReportRowDto[];
  @ApiProperty({ type: [BundleDemandRowDto] }) demand!: BundleDemandRowDto[];
}
