/**
 * Order Import DTO
 *
 * Request and response of the manual order import (#4228): import the orders of
 * a chosen date range, oldest or newest first. Whether the connection supports
 * it, and whether `to` is not before `from`, is decided by
 * `ConnectionService.startOrderImport`, which knows the adapter.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSyncStartOrderValues } from '@openlinker/core/sync';
import { OrderSyncStartOrder } from '@openlinker/core/sync';

/** A calendar date (YYYY-MM-DD) or an ISO 8601 instant. */
export const ORDER_IMPORT_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ORDER_IMPORT_DATE_MAX_LENGTH = 40;

export class OrderImportDto {
  @ApiPropertyOptional({
    description:
      'First day to import: an ISO date (YYYY-MM-DD) or ISO date-time. Omitted: from the oldest order.',
    example: '2026-10-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_IMPORT_DATE_MAX_LENGTH)
  @Matches(ORDER_IMPORT_DATE_PATTERN, { message: 'from must be an ISO date or date-time' })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Last day to import: an ISO date (YYYY-MM-DD) or ISO date-time, not before `from`. Omitted: up to the newest order.',
    example: '2026-10-31',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_IMPORT_DATE_MAX_LENGTH)
  @Matches(ORDER_IMPORT_DATE_PATTERN, { message: 'to must be an ISO date or date-time' })
  to?: string;

  @ApiProperty({
    description: 'Which end of the range is imported first.',
    enum: OrderSyncStartOrderValues,
    example: 'newest-first',
  })
  @IsIn(OrderSyncStartOrderValues)
  direction!: OrderSyncStartOrder;
}

export class OrderImportResponseDto {
  @ApiProperty({ description: 'Identifies this import run; every page of it carries it.' })
  runId!: string;
}

export class OrderSyncRestartResponseDto {
  @ApiProperty({
    description:
      'False when nothing was reset because the feed already imports new orders from its last check.',
  })
  applied!: boolean;

  @ApiPropertyOptional({ description: 'Why nothing was reset.', enum: ['already-following-feed'] })
  reason?: 'already-following-feed';
}
