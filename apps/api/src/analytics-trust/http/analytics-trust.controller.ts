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
import type { AnalyticsTrustSnapshot } from '@openlinker/core/analytics-trust';
import {
  ANALYTICS_TRUST_SERVICE_TOKEN,
  IAnalyticsTrustService,
} from '@openlinker/core/analytics-trust';
import {
  AnalyticsTrustResponseDto,
  ConnectionIngestionTrustResponseDto,
} from '../dto/analytics-trust-response.dto';
import { AnyRole } from '../../auth/decorators/any-role.decorator';

@ApiBearerAuth()
@ApiTags('analytics-trust')
@Controller('analytics')
export class AnalyticsTrustController {
  constructor(
    @Inject(ANALYTICS_TRUST_SERVICE_TOKEN)
    private readonly analyticsTrustService: IAnalyticsTrustService
  ) {}

  @AnyRole()
  @Get('trust')
  @ApiOperation({
    summary: 'Get the analytics data-trust snapshot',
    description:
      'Reports, for every OrderSource-capable connection regardless of status, when its ingestion ' +
      'pipe last polled successfully, when it last actually ingested an order, when the connection ' +
      "was created, and whether it appears stalled or disconnected (e.g. needs_reauth).",
  })
  @ApiResponse({ status: 200, type: AnalyticsTrustResponseDto })
  async getTrust(): Promise<AnalyticsTrustResponseDto> {
    const snapshot = await this.analyticsTrustService.getIngestionTrustSnapshot();
    return this.toResponseDto(snapshot);
  }

  private toResponseDto(snapshot: AnalyticsTrustSnapshot): AnalyticsTrustResponseDto {
    const dto = new AnalyticsTrustResponseDto();
    dto.generatedAt = snapshot.generatedAt.toISOString();
    dto.worstStatus = snapshot.worstStatus;
    dto.connections = snapshot.connections.map((entry) => {
      const connectionDto = new ConnectionIngestionTrustResponseDto();
      connectionDto.connectionId = entry.connectionId;
      connectionDto.connectionName = entry.connectionName;
      connectionDto.platformType = entry.platformType;
      connectionDto.connectionStatus = entry.connectionStatus;
      connectionDto.status = entry.status;
      connectionDto.lastPollAt = entry.lastPollAt ? entry.lastPollAt.toISOString() : null;
      connectionDto.lastOrderIngestedAt = entry.lastOrderIngestedAt
        ? entry.lastOrderIngestedAt.toISOString()
        : null;
      connectionDto.connectionCreatedAt = entry.connectionCreatedAt.toISOString();
      connectionDto.earliestOrderDate = entry.earliestOrderDate
        ? entry.earliestOrderDate.toISOString()
        : null;
      connectionDto.expectedIntervalMs = entry.expectedIntervalMs;
      connectionDto.staleAfterMs = entry.staleAfterMs;
      return connectionDto;
    });
    return dto;
  }
}
