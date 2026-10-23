/**
 * Create Order Export Request DTO (#3534, D35)
 *
 * Extends `ListOrdersQueryDto` so the export's filters are parsed and
 * validated by the EXACT SAME class `GET /orders` uses (AC: "reuse the same
 * `toOrderRecordFilters` as `GET /orders`") — the pagination fields it
 * inherits are simply unused here.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderExportFormatValues,
  OrderExportScopeValues,
  type OrderExportFormat,
  type OrderExportScope,
} from '@openlinker/core/orders';
import { ListOrdersQueryDto } from './list-orders-query.dto';

/** Mirrors the worker's own bound (`ORDER_EXPORT_ROW_CAP`) — refused here before a job is even enqueued for an obviously-too-large explicit selection. */
const MAX_SELECTED_ORDER_IDS = 5000;

export class CreateOrderExportDto extends ListOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderExportFormatValues, default: 'csv' })
  @IsOptional()
  @IsEnum(OrderExportFormatValues)
  format?: OrderExportFormat;

  @ApiPropertyOptional({ enum: OrderExportScopeValues, default: 'filtered' })
  @IsOptional()
  @IsEnum(OrderExportScopeValues)
  scope?: OrderExportScope;

  @ApiPropertyOptional({
    type: [String],
    description: 'Explicit order ids — required when scope=selected.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SELECTED_ORDER_IDS)
  @IsString({ each: true })
  selectedOrderIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Column ids, in order — from the caller\'s saved column preset.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  columns?: string[];

  // D35 — the export's own date axis (`placedAt`), independent of the
  // inherited `createdFrom`/`createdTo` (`createdAt`, the list's default).
  @ApiPropertyOptional({ description: 'Filter by order placement date (inclusive, ISO 8601) — the export default date field (D35).' })
  @IsOptional()
  @IsDateString()
  placedFrom?: string;

  @ApiPropertyOptional({ description: 'Filter by order placement date (inclusive, ISO 8601).' })
  @IsOptional()
  @IsDateString()
  placedTo?: string;
}
