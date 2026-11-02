/**
 * List Inventory Movements Query DTO (#3565)
 *
 * Query parameters for GET /inventory/movements. All fields are optional.
 * `withTotal` is inherited from {@link PaginatedReadQueryDto} (#2944).
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  InventoryHistoryKindFilterValues,
  InventoryMovementReasonValues,
  type InventoryHistoryKindFilter,
  type InventoryMovementReason,
} from '@openlinker/core/inventory';
import { PaginatedReadQueryDto } from '../../../common/dto/paginated-read-query.dto';

/** Accepts `?reasons=a,b` and repeated `?reasons=a&reasons=b` alike. */
function toStringList(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }
  return value;
}

export class MovementFiltersQueryDto extends PaginatedReadQueryDto {
  @ApiPropertyOptional({ description: 'Filter by internal product ID' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Filter by internal product variant ID' })
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @ApiPropertyOptional({
    enum: InventoryMovementReasonValues,
    isArray: true,
    description:
      'Only movements with one of these reasons (comma-separated or repeated). ' +
      'Promised (reservation) rows have no reason, so they are left out when this is set.',
  })
  @IsOptional()
  @Transform(({ value }) => toStringList(value))
  @IsArray()
  @ArrayMaxSize(InventoryMovementReasonValues.length)
  @IsIn(InventoryMovementReasonValues, { each: true })
  reasons?: InventoryMovementReason[];

  @ApiPropertyOptional({ description: 'Filter by the master connection that owns the position' })
  @IsOptional()
  @IsString()
  sourceConnectionId?: string;

  @ApiPropertyOptional({ description: 'Earliest timestamp (ISO 8601), inclusive' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Latest timestamp (ISO 8601), inclusive' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'When true, only movements that were refused or whose outcome is unknown (in doubt). ' +
      'Promised rows are left out.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  needsAttention?: boolean;

  @ApiPropertyOptional({
    enum: InventoryHistoryKindFilterValues,
    default: 'all',
    description: '`movements` = stock changes only, `promised` = reservations only.',
  })
  @IsOptional()
  @IsIn(InventoryHistoryKindFilterValues)
  kind?: InventoryHistoryKindFilter;

  @ApiPropertyOptional({
    maxLength: 100,
    description: "Case-insensitive substring of a variant's SKU or its product's name",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListInventoryMovementsQueryDto extends MovementFiltersQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of rows to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
