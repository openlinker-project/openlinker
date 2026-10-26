/**
 * Create/Update Order Tag DTOs (#3532, D34)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BULK_ORDER_ACTION_MAX } from '../bulk-row-result';
import { OrderTagColorValues, type OrderTagColor } from '@openlinker/core/orders';

export class CreateOrderTagDto {
  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ enum: OrderTagColorValues })
  @IsEnum(OrderTagColorValues)
  color!: OrderTagColor;
}

export class UpdateOrderTagDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ enum: OrderTagColorValues })
  @IsOptional()
  @IsEnum(OrderTagColorValues)
  color?: OrderTagColor;
}

export class BulkAssignOrderTagDto {
  @ApiProperty({ type: [String], maxItems: BULK_ORDER_ACTION_MAX })
  @ArrayMaxSize(BULK_ORDER_ACTION_MAX)
  @IsString({ each: true })
  orderIds!: string[];
}

/** Same body as bulk-assign (#3545). */
export class BulkRemoveOrderTagDto extends BulkAssignOrderTagDto {}
