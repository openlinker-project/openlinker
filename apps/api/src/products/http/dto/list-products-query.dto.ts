/**
 * List Products Query DTO
 *
 * Query parameters for GET /products. All fields are optional. The #1720
 * cockpit additions (sort/dir/stock/unlistedOn/connectionId) validate against
 * the products-context as-const unions so BE and wire vocabulary stay in sync.
 *
 * @module apps/api/src/products/http/dto
 */
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductListSortDirectionValues,
  ProductListSortFieldValues,
  ProductStockFilterValues,
} from '@openlinker/core/products';
import {
  ProductListSortDirection,
  ProductListSortField,
  ProductStockFilter,
} from '@openlinker/core/products';

export class ListProductsQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive search on product name or SKU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ProductListSortFieldValues,
    description: 'Sort field (#1720). Defaults to createdAt.',
  })
  @IsOptional()
  @IsIn(ProductListSortFieldValues)
  sort?: ProductListSortField;

  @ApiPropertyOptional({
    enum: ProductListSortDirectionValues,
    description: 'Sort direction (#1720). Defaults to desc.',
  })
  @IsOptional()
  @IsIn(ProductListSortDirectionValues)
  dir?: ProductListSortDirection;

  @ApiPropertyOptional({
    enum: ProductStockFilterValues,
    description:
      'Stock bucket filter (#1720): out (total = 0, incl. products with no inventory rows), ' +
      'low (0 < total <= 5), oversold (total < 0).',
  })
  @IsOptional()
  @IsIn(ProductStockFilterValues)
  stock?: ProductStockFilter;

  @ApiPropertyOptional({
    description:
      'CSV of connection IDs (#1720). Matches products having at least one variant with no ' +
      'Offer mapping for at least one of the given connections. Capped at 20 IDs.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  unlistedOn?: string;

  @ApiPropertyOptional({
    description:
      'Source-connection filter (#1720): products having a Product identifier mapping for this connection.',
  })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

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
