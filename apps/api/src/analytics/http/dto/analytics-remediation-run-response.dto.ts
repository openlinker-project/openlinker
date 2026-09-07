/**
 * Analytics Remediation Run Response DTO
 *
 * Response body for the currency-remediation endpoints (#2468): the run
 * created by `POST /analytics/coverage/currency/recalculate` and the same
 * shape polled by `GET /analytics/coverage/currency/status/:runId`.
 *
 * Maps the mockup's four currency states onto the lifecycle values the Phase 1
 * decision doc pinned: `currency-in-progress` -> `'in-progress'`,
 * `currency-fixed` -> `'resolved'`, `currency-failed` -> `'failed'` with
 * `detail` populated. `'open'` is never stored — it is the detector's live "no
 * repair has been asked for" value.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AnalyticsRemediationRunView } from '@openlinker/core/analytics';
import {
  CoverageResolutionStatusValues,
  type CoverageResolutionStatus,
} from '@openlinker/core/orders';

export class AnalyticsRemediationRunResponseDto {
  @ApiProperty({ description: 'Run id (`ol_remrun_…`).' })
  id!: string;

  @ApiProperty({ description: 'Data Coverage category this run repairs. Always `currency` today.' })
  category!: string;

  @ApiProperty({ enum: CoverageResolutionStatusValues })
  status!: CoverageResolutionStatus;

  @ApiPropertyOptional({
    description:
      'Operator-readable failure detail. Always present and non-empty when `status` is `failed`, `null` otherwise.',
    nullable: true,
  })
  detail!: string | null;

  @ApiProperty({
    description:
      'Orders the detector counted when the operator asked. A point-in-time figure — completion is decided by re-reading the population, not by counting down from this.',
  })
  affectedCount!: number;

  @ApiProperty({ description: 'User id that triggered the run.' })
  triggeredByUserId!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromView(view: AnalyticsRemediationRunView): AnalyticsRemediationRunResponseDto {
    const dto = new AnalyticsRemediationRunResponseDto();
    dto.id = view.id;
    dto.category = view.category;
    dto.status = view.status;
    dto.detail = view.detail;
    dto.affectedCount = view.affectedCount;
    dto.triggeredByUserId = view.triggeredByUserId;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}
