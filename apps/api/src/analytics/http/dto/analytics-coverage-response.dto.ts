/**
 * Analytics Coverage Response DTO
 *
 * Response body for `GET /analytics/coverage` (#2466, epic #2452 mini-epic
 * #2463) — one row per Data Coverage category, elevating the currency
 * (#2464) and tax A/B/C (#2465) exclusion counts plus the new
 * product-matching-error detector into the mockup's `all-clear` /
 * `detail-*` states.
 *
 * `status` was hardcoded `'open'` for every row through Phase 6. Phase 7
 * (#2475) makes the `'currency'` row honest about an in-flight repair: the
 * controller checks `IAnalyticsRemediationRunService.getOpenRun('currency')`
 * and, when one exists, reports `status: 'in-progress'` plus the row's
 * `activeRunId` — this is what lets the FE recover the live sub-state after
 * a page reload (Task 7.1's own problem statement) instead of only tracking
 * it in local component state from the moment the operator clicked
 * "Recalculate now" in THIS session. `getOpenRun` only ever answers
 * `'in-progress'` (a terminal `'failed'` run is not "open" — the partial
 * unique index it enforces covers `open`/`in-progress` only, see
 * `OPEN_REMEDIATION_RUN_STATUSES`), so a page reload after a FAILURE
 * legitimately re-reads as `'open'` rather than resurrecting the failure
 * banner — the operator retries, they don't need history replayed. Every
 * other category's `status` stays `'open'`, per the Phase 1 decision doc's
 * scoping note: no run is ever written for tax or product-matching.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({
    description:
      "The in-flight `analytics_remediation_runs` id when `status` is `'in-progress'` — poll `GET .../currency/status/:runId` with it. `null`/absent otherwise. Only ever set for the `'currency'` row.",
    nullable: true,
  })
  activeRunId?: string | null;

  static of(
    category: CoverageCategory,
    affectedCount: number,
    sampleOrderIds: string[],
    activeRunId: string | null = null
  ): CoverageCategoryRowDto {
    const dto = new CoverageCategoryRowDto();
    dto.category = category;
    dto.status = activeRunId ? 'in-progress' : 'open';
    dto.affectedCount = affectedCount;
    dto.sampleOrderIds = sampleOrderIds;
    if (activeRunId) {
      dto.activeRunId = activeRunId;
    }
    return dto;
  }
}

export class AnalyticsCoverageResponseDto {
  @ApiProperty({ type: [CoverageCategoryRowDto] })
  categories!: CoverageCategoryRowDto[];
}
