/**
 * Currency Recalculate Request DTO
 *
 * Body for `POST /analytics/coverage/currency/recalculate` (#2468). The three
 * fields are deliberately the SAME window the Data Coverage panel was showing
 * when the operator pressed the button, so the repair can never be wider than
 * the count they were shown — `AnalyticsCoverageQueryDto`'s fields, moved into
 * a body because this is a mutation.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CurrencyRecalculateRequestDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601), bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601), bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow the repair to a single source connection (UUID).' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}
