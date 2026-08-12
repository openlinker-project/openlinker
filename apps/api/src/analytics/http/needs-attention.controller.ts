/**
 * Needs Attention Controller
 *
 * HTTP surface for the `/analytics` "needs attention" section (#1983,
 * frontend consumer #1989): coverage gaps, stock at risk, and value stuck in
 * failed syncs.
 *
 * @module apps/api/src/analytics/http
 */
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NeedsAttentionService } from '../application/services/needs-attention.service';
import {
  CoverageGapItemDto,
  FailedSyncValueSummaryDto,
  NeedsAttentionResponseDto,
  StockAtRiskItemDto,
} from './dto/needs-attention-response.dto';

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class NeedsAttentionController {
  constructor(private readonly needsAttentionService: NeedsAttentionService) {}

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
    dto.stockAtRisk = summary.stockAtRisk.map((item) => StockAtRiskItemDto.fromDomain(item));
    dto.failedSyncValue = FailedSyncValueSummaryDto.fromDomain(summary.failedSyncValue);
    return dto;
  }
}
