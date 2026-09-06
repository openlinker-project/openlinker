/**
 * Connection Filters DTO
 *
 * Query parameter DTO for filtering connections when listing.
 * All fields are optional.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionStatusValues } from '@openlinker/core/identifier-mapping';

export class ConnectionFiltersDto {
  @ApiPropertyOptional({
    description: 'Filter by platform type',
    example: 'prestashop',
  })
  @IsString()
  @IsOptional()
  platformType?: string;

  @ApiPropertyOptional({
    description: 'Filter by connection status',
    enum: ConnectionStatusValues,
    example: 'active',
  })
  @IsEnum(ConnectionStatusValues)
  @IsOptional()
  status?: 'active' | 'disabled' | 'error';

  /**
   * Deliberately UNDEFAULTED (#2937) — presence of either `limit` or
   * `offset` is what switches the response from the legacy bare array to
   * the paginated envelope (`ConnectionController.list`). Defaulting this
   * the way `ListOrdersQueryDto.limit` does would silently truncate every
   * caller that omits pagination today (the command palette, capability
   * pickers, lookup tables) to one page, which is the exact regression
   * this endpoint's backward-compat contract exists to avoid.
   */
  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Page size (paginated form only)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Number of items to skip (paginated form only)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

