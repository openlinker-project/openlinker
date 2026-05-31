/**
 * Order Health Summary Query DTO
 *
 * Query parameters for GET /orders/status-summary (#929). Deliberately a
 * narrow scope subset — source / customer / date only. It intentionally omits
 * `health`, `syncStatus`, and pagination so the aggregate can't be
 * self-filtered into a contradiction (counting all buckets while scoped to
 * one). Mirrors `OrderHealthSummaryFilters` in `@openlinker/core/orders`.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsOptional, IsUUID, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class OrderHealthSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Filter by source connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiPropertyOptional({ description: 'Filter by internal customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Count orders created on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Count orders created on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
