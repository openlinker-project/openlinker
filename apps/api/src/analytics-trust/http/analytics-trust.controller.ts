/**
 * Analytics Trust Controller
 *
 * HTTP REST API endpoint for the analytics data-trust read (#1982): a
 * single GET the /analytics page can call before rendering any figure, to
 * disclose the limits of the ingested data it reports over. Read-only —
 * protected by the global JwtAuthGuard (apps/api's default), no
 * additional role restriction (operator-facing read).
 *
 * @module apps/api/src/analytics-trust/http
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { IAnalyticsTrustService, AnalyticsTrustSnapshot } from '@openlinker/core/analytics-trust';
import { ANALYTICS_TRUST_SERVICE_TOKEN } from '@openlinker/core/analytics-trust';
import {
  AnalyticsTrustResponseDto,
  ConnectionIngestionTrustResponseDto,
} from '../dto/analytics-trust-response.dto';

@ApiBearerAuth()
@ApiTags('analytics-trust')
@Controller('analytics')
export class AnalyticsTrustController {
  constructor(
    @Inject(ANALYTICS_TRUST_SERVICE_TOKEN)
    private readonly analyticsTrustService: IAnalyticsTrustService
  ) {}

  @Get('trust')
  @ApiOperation({
    summary: 'Get the analytics data-trust snapshot',
    description:
      'Reports, for every active OrderSource-capable connection, when it last successfully ingested, ' +
      'how far back its data goes, and whether ingestion appears stalled.',
  })
  @ApiResponse({ status: 200, type: AnalyticsTrustResponseDto })
  async getTrust(): Promise<AnalyticsTrustResponseDto> {
    const snapshot = await this.analyticsTrustService.getIngestionTrustSnapshot();
    return this.toResponseDto(snapshot);
  }

  private toResponseDto(snapshot: AnalyticsTrustSnapshot): AnalyticsTrustResponseDto {
    const dto = new AnalyticsTrustResponseDto();
    dto.generatedAt = snapshot.generatedAt.toISOString();
    dto.connections = snapshot.connections.map((entry) => {
      const connectionDto = new ConnectionIngestionTrustResponseDto();
      connectionDto.connectionId = entry.connectionId;
      connectionDto.connectionName = entry.connectionName;
      connectionDto.platformType = entry.platformType;
      connectionDto.status = entry.status;
      connectionDto.lastSuccessfulIngestionAt = entry.lastSuccessfulIngestionAt
        ? entry.lastSuccessfulIngestionAt.toISOString()
        : null;
      connectionDto.coverageStartAt = entry.coverageStartAt.toISOString();
      connectionDto.expectedIntervalMs = entry.expectedIntervalMs;
      connectionDto.staleAfterMs = entry.staleAfterMs;
      return connectionDto;
    });
    return dto;
  }
}
