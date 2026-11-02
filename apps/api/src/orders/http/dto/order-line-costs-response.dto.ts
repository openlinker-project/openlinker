/**
 * Order Line Costs Response DTO (#3588)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { MarginGapReasonValues, type MarginGapReason } from '@openlinker/core/orders';

export class OrderLineCostDto {
  @ApiProperty()
  lineNumber!: number;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ nullable: true, type: String })
  variantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sku!: string | null;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'VAT-exclusive line revenue, order currency.' })
  netAmount!: number | null;

  @ApiProperty({ enum: ['recorded', 'not-recorded'] })
  costState!: 'recorded' | 'not-recorded';

  @ApiProperty({ nullable: true, type: String, description: 'Decimal string; 0.00 is a real cost.' })
  unitCostNet!: string | null;

  @ApiProperty({ nullable: true, type: String })
  unitCostCurrency!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  costOfGoods!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  margin!: number | null;

  @ApiProperty({ nullable: true, enum: MarginGapReasonValues })
  gapReason!: MarginGapReason | null;

  @ApiProperty()
  netEligible!: boolean;
}

export class OrderLineCostsResponseDto {
  @ApiProperty({ nullable: true, type: String })
  currency!: string | null;

  @ApiProperty({ type: [OrderLineCostDto] })
  lines!: OrderLineCostDto[];
}
