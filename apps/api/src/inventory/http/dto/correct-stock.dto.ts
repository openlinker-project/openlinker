/**
 * Correct Stock DTO (#3566)
 *
 * Request body for POST /inventory/:productVariantId/adjust. The actor is never
 * in the body - it is the authenticated user.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  InventoryCorrectionModeValues,
  InventoryMovementOperatorReasonValues,
  type InventoryCorrectionMode,
  type InventoryMovementOperatorReason,
} from '@openlinker/core/inventory';

export class CorrectStockDto {
  @ApiProperty({
    enum: InventoryCorrectionModeValues,
    description:
      '`set`: make the stock exactly `quantity` (the master is read first and the change computed from ' +
      'its own current number). `delta`: add the signed `quantity`.',
  })
  @IsIn(InventoryCorrectionModeValues)
  mode!: InventoryCorrectionMode;

  @ApiProperty({
    description: '`set`: the wanted stock (0 or more). `delta`: the signed change (not 0).',
    example: 12,
  })
  // A negative `set` quantity is refused by the service as `invalid-quantity` (400): the
  // minimum depends on `mode`, which a per-property decorator cannot see.
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ enum: InventoryMovementOperatorReasonValues })
  @IsIn(InventoryMovementOperatorReasonValues)
  operatorReason!: InventoryMovementOperatorReason;

  @ApiPropertyOptional({ maxLength: 500, description: 'Required when the reason is `other`.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'One per dialog open. A repeat returns the first outcome and sends nothing to the product master again.',
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description:
      'Required to proceed past a 409 `confirmation-required` (more than 50 units, or more than 50% of ' +
      'the current stock).',
  })
  @IsOptional()
  @IsBoolean()
  confirmLargeChange?: boolean;
}
