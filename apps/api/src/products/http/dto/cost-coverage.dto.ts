/**
 * Cost Coverage / Work List DTOs (#3588, mockup M30)
 *
 * Query and response shapes of `GET /products/cost-coverage[/summary]` and
 * `GET /products/variants/cost-worklist[/count]`. Amounts are VAT-exclusive, in
 * the system reporting currency. Like the cost write DTOs these are served only
 * on admin/operator/viewer routes, never on an `@AnyRole()` one.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  COST_COVERAGE_DEFAULT_DAYS,
  COST_COVERAGE_MAX_DAYS,
  COST_COVERAGE_MIN_DAYS,
  CostWorklistTabValues,
  MarginGapReasonValues,
  type CostWorklistTab,
  type MarginGapReason,
} from '@openlinker/core/orders';
import { PaginatedReadQueryDto } from '../../../common/dto/paginated-read-query.dto';

export class CostCoverageQueryDto {
  @ApiPropertyOptional({
    default: COST_COVERAGE_DEFAULT_DAYS,
    minimum: COST_COVERAGE_MIN_DAYS,
    maximum: COST_COVERAGE_MAX_DAYS,
    description: 'Window: the last N UTC days by order date, today included',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(COST_COVERAGE_MIN_DAYS)
  @Max(COST_COVERAGE_MAX_DAYS)
  days?: number = COST_COVERAGE_DEFAULT_DAYS;
}

export class CostWorklistQueryDto extends PaginatedReadQueryDto {
  @ApiPropertyOptional({
    enum: CostWorklistTabValues,
    default: 'sold',
    description:
      'sold = no cost and net sales in the last 30 days; all = every variant without a cost; has-cost = variants with a cost',
  })
  @IsOptional()
  @IsIn(CostWorklistTabValues as unknown as string[])
  tab?: CostWorklistTab = 'sold';

  @ApiPropertyOptional({ description: 'Case-insensitive match on product name or SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    description: 'Source connection id of the sales; narrows the sales columns and requires a sale there',
  })
  @IsOptional()
  @IsUUID()
  channel?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class CostWorklistCountQueryDto extends OmitType(CostWorklistQueryDto, [
  'limit',
  'offset',
  'withTotal',
] as const) {}

export class CostGapReasonDto {
  @ApiProperty({ enum: MarginGapReasonValues }) reason!: MarginGapReason;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ description: 'Net sales of these lines, reporting currency' }) netAmount!: number;
}

export class CostCoverageTopVariantDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: Object, nullable: true, additionalProperties: { type: 'string' } })
  attributes!: Record<string, string> | null;
  @ApiProperty() netSales!: number;
}

export class CostCoverageResponseDto {
  @ApiProperty() days!: number;
  @ApiProperty({ type: String, format: 'date-time' }) from!: string;
  @ApiProperty({ type: String, format: 'date-time', description: 'Exclusive end' }) to!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Distinct non-stale variants with net sales in the window' })
  soldVariantCount!: number;
  @ApiProperty({ description: 'Of those, variants that currently have no cost' })
  soldVariantsWithoutCost!: number;
  @ApiProperty() netSales!: number;
  @ApiProperty({ description: 'Net sales of variants that currently have no cost' })
  netSalesWithoutCost!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Percent 0..100, null without net sales' })
  coveragePct!: number | null;
  @ApiProperty({ description: 'Net sales margin leaves out (sum of every gap reason)' })
  notInMarginNetSales!: number;
  @ApiProperty({ type: [CostGapReasonDto] }) gapByReason!: CostGapReasonDto[];
  @ApiProperty({ type: [CostCoverageTopVariantDto] }) top3!: CostCoverageTopVariantDto[];
  @ApiProperty({ type: Number, nullable: true, description: 'Percent 0..100 of netSalesWithoutCost' })
  top3SharePct!: number | null;
  @ApiProperty({ description: 'Net sales of lines with no variant (no per-variant cost possible)' })
  productOnlyNetSales!: number;
}

export class CostSummaryResponseDto {
  @ApiProperty() variantsWithoutCost!: number;
  @ApiProperty() productsWithoutCost!: number;
  @ApiProperty() variantsWithCost!: number;
}

export class CostWorklistSoldOnDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty({ type: String, nullable: true }) platformType!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
}

export class CostWorklistRowDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: Object, nullable: true, additionalProperties: { type: 'string' } })
  attributes!: Record<string, string> | null;
  @ApiProperty({ type: String, nullable: true }) netUnitCost!: string | null;
  @ApiProperty({ type: String, nullable: true }) costCurrency!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) costUpdatedAt!: string | null;
  @ApiProperty() netSales30d!: number;
  @ApiProperty() units30d!: number;
  @ApiProperty({ type: [CostWorklistSoldOnDto] }) soldOn!: CostWorklistSoldOnDto[];
}

export class CostWorklistResponseDto {
  @ApiProperty({ description: 'Reporting currency of netSales30d' }) currency!: string;
  @ApiProperty({ type: [CostWorklistRowDto] }) items!: CostWorklistRowDto[];
  @ApiPropertyOptional({ description: 'Omitted when ?withTotal=false (never 0)' })
  total?: number;
}
