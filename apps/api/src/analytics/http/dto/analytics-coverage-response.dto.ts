/**
 * Analytics Coverage Response DTO
 *
 * Response body for `GET /analytics/coverage` (#2466, epic #2452 mini-epic
 * #2463) — one row per Data Coverage category, elevating the currency
 * (#2464) and tax A/B/C (#2465) exclusion counts plus the new
 * product-matching-error detector into the mockup's `all-clear` /
 * `detail-*` states.
 *
 * `status` is hardcoded `'open'` for every row today — a later phase of
 * this epic is the only intended writer of `'in-progress'` /
 * `'resolved'` / `'failed'`, and only for the `'currency'` category (per
 * the Phase 1 decision doc's scoping note). This DTO does not invent a
 * status this build cannot produce.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  CoverageCategoryValues,
  CoverageResolutionStatusValues,
  type CoverageCategory,
  type CoverageResolutionStatus,
} from '@openlinker/core/orders';

export class CoverageCategoryRowDto {
  @ApiProperty({ enum: CoverageCategoryValues })
  category!: CoverageCategory;

  @ApiProperty({ enum: CoverageResolutionStatusValues })
  status!: CoverageResolutionStatus;

  @ApiProperty({ description: 'Total orders in this category for the requested range.' })
  affectedCount!: number;

  @ApiProperty({
    description: 'A small sample of affected internal order ids, newest-first.',
    type: [String],
  })
  sampleOrderIds!: string[];

  static of(
    category: CoverageCategory,
    affectedCount: number,
    sampleOrderIds: string[]
  ): CoverageCategoryRowDto {
    const dto = new CoverageCategoryRowDto();
    dto.category = category;
    dto.status = 'open';
    dto.affectedCount = affectedCount;
    dto.sampleOrderIds = sampleOrderIds;
    return dto;
  }
}

export class AnalyticsCoverageResponseDto {
  @ApiProperty({ type: [CoverageCategoryRowDto] })
  categories!: CoverageCategoryRowDto[];
}
