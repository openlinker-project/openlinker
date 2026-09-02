/**
 * Analytics Coverage By-Connection Response DTO
 *
 * Response body for `GET /analytics/coverage/by-connection` (#2713) — the
 * server-side `GROUP BY sourceConnectionId` counterpart of
 * `AnalyticsCoverageResponseDto`. `channel-sales-table.tsx`'s
 * `useCoverageCrossReferenceQuery` previously derived this same shape
 * client-side by paging through the full affected-order list; this endpoint
 * lets the FE ask for per-connection counts directly instead.
 *
 * Deliberately carries no `status`/`activeRunId` per row — those are
 * per-CATEGORY lifecycle facts (`AnalyticsCoverageResponseDto`'s concern),
 * not per-connection ones.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { CoverageCategoryValues, type CoverageCategory } from '@openlinker/core/orders';

export class CoverageConnectionRowDto {
  @ApiProperty({ description: 'The connection this count belongs to.' })
  sourceConnectionId!: string;

  @ApiProperty({
    description: 'Total orders in this category, on this connection, for the requested range.',
  })
  affectedCount!: number;
}

export class CoverageCategoryConnectionRowsDto {
  @ApiProperty({ enum: CoverageCategoryValues })
  category!: CoverageCategory;

  @ApiProperty({ type: [CoverageConnectionRowDto] })
  rows!: CoverageConnectionRowDto[];

  static of(
    category: CoverageCategory,
    rows: CoverageConnectionRowDto[]
  ): CoverageCategoryConnectionRowsDto {
    const dto = new CoverageCategoryConnectionRowsDto();
    dto.category = category;
    dto.rows = rows;
    return dto;
  }
}

export class AnalyticsCoverageByConnectionResponseDto {
  @ApiProperty({ type: [CoverageCategoryConnectionRowsDto] })
  categories!: CoverageCategoryConnectionRowsDto[];
}
