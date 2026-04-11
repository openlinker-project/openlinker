/**
 * List Product Variants Query DTO
 *
 * Query parameters for GET /products/:productId/variants and GET /variants/search.
 * All fields are optional.
 *
 * @module apps/api/src/products/http/dto
 */
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListProductVariantsQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive search on variant SKU, EAN, or GTIN' })
  @IsOptional()
  @IsString()
  search?: string;

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
