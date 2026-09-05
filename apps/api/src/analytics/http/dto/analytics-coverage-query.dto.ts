/**
 * Analytics Coverage Query DTO
 *
 * Query parameters for `GET /analytics/coverage` (#2466). `from`/`to` are
 * required, mirroring `SalesAnalyticsQueryDto` — a coverage query without a
 * range is not meaningful, since every detector (currency, tax A/B/C,
 * product-matching) is scoped to a date window.
 *
 * The window means two different things per category, and that split is
 * deliberate rather than an oversight: the currency and tax detectors
 * bucket by `placedAt` (mirroring `SalesAnalyticsFilters`, since they read
 * the SAME `netExcludedCount`/`unconvertedCount` population
 * `getDailyOrderAggregates` computes), while the product-matching detector
 * buckets by `createdAt` (mirroring `OrderHealthSummaryFilters`) — an
 * `awaiting_mapping`/`source_deleted` order has no resolved `placedAt` yet
 * (#1985 populates it only for `recordStatus = 'ready'` records), so a
 * `placedAt` filter would silently exclude every product-matching row.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsCoverageQueryDto {
  @ApiProperty({
    description:
      'Range start, inclusive (ISO 8601). Bucketed by placedAt (currency/tax) or createdAt (product-matching).',
  })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({
    description:
      'Range end, exclusive (ISO 8601). Bucketed by placedAt (currency/tax) or createdAt (product-matching) — see class doc.',
  })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to a single source connection (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}
