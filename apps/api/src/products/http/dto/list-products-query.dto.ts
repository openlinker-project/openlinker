/**
 * List Products Query DTO
 *
 * Query parameters for GET /products. All fields are optional. The #1720
 * cockpit additions (sort/dir/stock/unlistedOn/connectionId) validate against
 * the products-context as-const unions so BE and wire vocabulary stay in sync.
 *
 * @module apps/api/src/products/http/dto
 */
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
import { Type, Transform } from 'class-transformer';
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
    enum: ['missing', 'not-checked', 'known'],
    description:
      'Tax-rate read state (#2255): "missing" = the shop was asked and has no rate (the ' +
      'population that holds documents), "not-checked" = nobody has asked yet (needs a product ' +
      'sync, not a catalogue edit), "known" = a rate is on record, including a deliberate zero. ' +
      'Keeping the first two apart is what stops day one reading as a catalogue-wide failure.',
  })
  @IsOptional()
  @IsIn(['missing', 'not-checked', 'known'])
  taxRateState?: 'missing' | 'not-checked' | 'known';

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

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Hide products where every variant is deleted at the master (#1599/#2447). A product ' +
      'with at least one live variant, or with no variants at all, is always kept.',
  })
  @IsOptional()
  // Query params arrive as strings — mirror list-orders-query.dto.ts's boolean coercion so a
  // stray value 400s instead of silently returning the unfiltered list.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hideFullyStale?: boolean;

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
