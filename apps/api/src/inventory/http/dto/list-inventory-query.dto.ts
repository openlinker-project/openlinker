/**
 * List Inventory Query DTO
 *
 * Query parameters for GET /inventory. All fields are optional.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListInventoryQueryDto {
  @ApiPropertyOptional({ description: 'Filter by internal product ID' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Filter by internal product variant ID' })
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @ApiPropertyOptional({ description: 'Filter by location ID' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
