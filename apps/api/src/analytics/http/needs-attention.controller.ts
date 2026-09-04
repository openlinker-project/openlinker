/**
 * Needs Attention Controller
 *
 * HTTP surface for the `/analytics` "needs attention" section (#1983,
 * frontend consumer #1989): coverage gaps, stock at risk, and value stuck in
 * failed syncs.
 *
 * @module apps/api/src/analytics/http
 *
 * **`@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()` (#2413).** See
 * `sales-analytics.controller.ts` for the reasoning shared by every analytics
 * read.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  NEEDS_ATTENTION_SERVICE_TOKEN,
  type INeedsAttentionService,
} from '../application/services/needs-attention.service.interface';
import {
  CoverageGapItemDto,
  FailedSyncValueSummaryDto,
  NeedsAttentionResponseDto,
  StockAtRiskItemDto,
} from './dto/needs-attention-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class NeedsAttentionController {
  constructor(
    @Inject(NEEDS_ATTENTION_SERVICE_TOKEN)
    private readonly needsAttentionService: INeedsAttentionService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('needs-attention')
  @ApiOperation({
    summary:
      'Coverage gaps, stock at risk, and value stuck in failed syncs — the /analytics "needs attention" section',
  })
  @ApiResponse({ status: 200, type: NeedsAttentionResponseDto })
  async getNeedsAttention(): Promise<NeedsAttentionResponseDto> {
    const summary = await this.needsAttentionService.getSummary();

    const dto = new NeedsAttentionResponseDto();
    dto.coverageGaps = summary.coverageGaps.map((item) => CoverageGapItemDto.fromDomain(item));
    dto.coverageGapsTotalCount = summary.coverageGapsTotalCount;
    dto.stockAtRisk = summary.stockAtRisk.map((item) => StockAtRiskItemDto.fromDomain(item));
    dto.stockAtRiskTotalCount = summary.stockAtRiskTotalCount;
    dto.failedSyncValue = FailedSyncValueSummaryDto.fromDomain(summary.failedSyncValue);
    return dto;
  }
}
