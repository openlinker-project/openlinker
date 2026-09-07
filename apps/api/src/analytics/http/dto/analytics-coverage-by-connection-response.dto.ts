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
import { TaxCoverageCategoryValues } from '@openlinker/core/orders';

/**
 * The categories this endpoint's controller actually emits (`'currency'` plus
 * the tax A/B/C sub-categories) — deliberately narrower than the full
 * `CoverageCategoryValues` union, which also carries `'product-matching'`.
 * `AnalyticsCoverageController.getCoverageByConnection` never dispatches that
 * category, so declaring it here would overstate the Swagger contract.
 */
export const CoverageCategoryConnectionRowValues = [
  'currency',
  ...TaxCoverageCategoryValues,
] as const;
export type CoverageCategoryConnectionRowCategory =
  (typeof CoverageCategoryConnectionRowValues)[number];

export class CoverageConnectionRowDto {
  @ApiProperty({ description: 'The connection this count belongs to.' })
  sourceConnectionId!: string;

  @ApiProperty({
    description: 'Total orders in this category, on this connection, for the requested range.',
  })
  affectedCount!: number;
}

export class CoverageCategoryConnectionRowsDto {
  @ApiProperty({ enum: CoverageCategoryConnectionRowValues })
  category!: CoverageCategoryConnectionRowCategory;

  @ApiProperty({ type: [CoverageConnectionRowDto] })
  rows!: CoverageConnectionRowDto[];

  static of(
    category: CoverageCategoryConnectionRowCategory,
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
