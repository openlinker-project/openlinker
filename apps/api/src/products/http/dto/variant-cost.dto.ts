/**
 * Variant Cost DTOs (#3588)
 *
 * Request/response shapes for the operator-authored net unit cost. Cost is
 * deliberately NOT on `ProductVariantResponseDto`: that one is served by
 * `@AnyRole()` routes a packer can call.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

/** numeric(12,4): at most 8 integer digits, 4 fractional ones. `0.00` is valid. */
export const NET_UNIT_COST_REGEX = /^\d{1,8}(\.\d{1,4})?$/;
export const COST_CURRENCY_REGEX = /^[A-Z]{3}$/;
export const BULK_COST_MAX_VARIANTS = 500;

/**
 * Set or clear one variant's cost. Both fields are required keys: a string
 * pair sets, a `null` pair clears. A half pair fails validation because the
 * `ValidateIf` only skips the checks when BOTH are exactly `null`.
 */
export class SetVariantCostRequestDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '12.5000',
    description: 'Net (VAT-exclusive) unit cost as a decimal string; null clears.',
  })
  @ValidateIf((o: SetVariantCostRequestDto) => o.netUnitCost !== null || o.currency !== null)
  @Matches(NET_UNIT_COST_REGEX, { message: 'netUnitCost must be a non-negative decimal string' })
  netUnitCost!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'PLN' })
  @ValidateIf((o: SetVariantCostRequestDto) => o.netUnitCost !== null || o.currency !== null)
  @Matches(COST_CURRENCY_REGEX, { message: 'currency must be an upper-case ISO 4217 code' })
  currency!: string | null;
}

/** Fill one cost across many variants, only where none is recorded yet. */
export class BulkFillVariantCostRequestDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: BULK_COST_MAX_VARIANTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_COST_MAX_VARIANTS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  variantIds!: string[];

  @ApiProperty({ type: String, example: '12.5000' })
  @Matches(NET_UNIT_COST_REGEX, { message: 'netUnitCost must be a non-negative decimal string' })
  netUnitCost!: string;

  @ApiProperty({ type: String, example: 'PLN' })
  @Matches(COST_CURRENCY_REGEX, { message: 'currency must be an upper-case ISO 4217 code' })
  currency!: string;
}

export class VariantCostResponseDto {
  @ApiProperty() variantId!: string;
  @ApiProperty({ type: String, nullable: true }) netUnitCost!: string | null;
  @ApiProperty({ type: String, nullable: true }) costCurrency!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  costUpdatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) costUpdatedByUserId!: string | null;
}

export class ProductVariantCostResponseDto extends VariantCostResponseDto {
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
}

export class BulkFillVariantCostResponseDto {
  @ApiProperty({ type: [String] }) filled!: string[];
  @ApiProperty({ type: [String] }) skippedAlreadySet!: string[];
  @ApiProperty({ type: [String] }) notFound!: string[];
}
