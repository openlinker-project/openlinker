/**
 * List Orders Query DTO
 *
 * Query parameters for GET /orders. All fields are optional.
 *
 * @module apps/api/src/orders/http/dto
 */
import {
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderSyncStatusFilterValues,
  OrderRecordStatusValues,
  OrderHealthValues,
  OrderRecordSortValues,
  OrderRecordSortDirectionValues,
} from '@openlinker/core/orders';
import {
  OrderSyncStatusFilter,
  OrderRecordStatus,
  OrderHealth,
  OrderRecordSort,
  OrderRecordSortDirection,
} from '@openlinker/core/orders';

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by source connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiPropertyOptional({
    enum: OrderSyncStatusFilterValues,
    description: 'Filter by sync status (matches any destination with this status)',
  })
  @IsOptional()
  @IsEnum(OrderSyncStatusFilterValues)
  syncStatus?: OrderSyncStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by internal customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Filter orders created on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Filter orders created on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: OrderRecordStatusValues,
    description:
      'Filter by record status (ready = fully resolved, awaiting_mapping = item refs unresolved)',
  })
  @IsOptional()
  @IsEnum(OrderRecordStatusValues)
  recordStatus?: OrderRecordStatus;

  @ApiPropertyOptional({
    enum: OrderHealthValues,
    description:
      'Filter by derived health bucket (#929) — partitions the set: awaiting_mapping | needs_attention | synced | awaiting_dispatch',
  })
  @IsOptional()
  @IsEnum(OrderHealthValues)
  health?: OrderHealth;

  @ApiPropertyOptional({
    enum: OrderRecordSortValues,
    description:
      'Result ordering (#927/#944). "dispatchBy" = ship-by deadline (triage default, NULLs last); "createdAt" = ingestion time; "customer"/"items"/"status"/"total" back the sortable table columns (derived from the order snapshot + health). Pair with `dir`.',
  })
  @IsOptional()
  @IsEnum(OrderRecordSortValues)
  sort?: OrderRecordSort;

  @ApiPropertyOptional({
    enum: OrderRecordSortDirectionValues,
    description:
      'Sort direction for `sort` (#944). Defaults per-column server-side when omitted; the UI sends an explicit direction once a header is clicked.',
  })
  @IsOptional()
  @IsEnum(OrderRecordSortDirectionValues)
  dir?: OrderRecordSortDirection;

  @ApiPropertyOptional({
    description:
      'Dispatch-SLA filter (#927): keep only orders with a known ship-by deadline at or before this instant (ISO 8601). Pass `now` for overdue, `now + window` for "breaching soon".',
  })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
