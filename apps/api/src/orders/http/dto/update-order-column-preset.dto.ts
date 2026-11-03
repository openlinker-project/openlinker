/**
 * Update Order Column Preset DTO (#3530)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateOrderColumnPresetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columns?: string[];
}
