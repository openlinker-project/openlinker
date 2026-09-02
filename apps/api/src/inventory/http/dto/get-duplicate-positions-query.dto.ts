/**
 * Get Duplicate Positions Query DTO
 *
 * Query-parameter shape for `GET /inventory/duplicate-positions` (#2319).
 * `maxGroups` bounds the returned group DETAIL only — the report's
 * `groupCount` / `rowCount` totals are always computed over the whole table,
 * because `groupCount` is the #2325 readiness gate.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_DUPLICATE_POSITION_GROUPS,
  MAX_DUPLICATE_POSITION_GROUPS,
} from '@openlinker/core/inventory';

export class GetDuplicatePositionsQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_DUPLICATE_POSITION_GROUPS,
    minimum: 1,
    maximum: MAX_DUPLICATE_POSITION_GROUPS,
    description:
      'Maximum number of duplicate GROUPS to return detail for, largest first. ' +
      'Does not affect the groupCount / rowCount / excessRowCount totals, which always ' +
      'cover the whole table.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DUPLICATE_POSITION_GROUPS)
  maxGroups?: number = DEFAULT_DUPLICATE_POSITION_GROUPS;
}

/**
 * Server-side cap on returned group detail. Re-exported so a client can chunk
 * or page against the same constant rather than hardcoding it (mirrors
 * INVENTORY_AVAILABILITY_MAX_VARIANT_IDS).
 */
export const INVENTORY_DUPLICATE_POSITIONS_MAX_GROUPS = MAX_DUPLICATE_POSITION_GROUPS;
