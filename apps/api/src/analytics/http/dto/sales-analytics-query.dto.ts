/**
 * Sales Analytics Query DTO
 *
 * Query parameters for `GET /analytics/sales` (#1987). Unlike
 * `OrderHealthSummaryQueryDto`'s optional date pair, `from`/`to` are
 * **required** here — a sales query without a range is not a meaningful
 * request.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SalesAnalyticsQueryDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to a single source connection (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}
