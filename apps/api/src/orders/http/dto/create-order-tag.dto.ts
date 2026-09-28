/**
 * Create/Update Order Tag DTOs (#3532, D34)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  orderIds!: string[];
}
