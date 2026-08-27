/**
 * Connection Sync Status Controller
 *
 * HTTP REST endpoint for the per-connection sync-status read (#2615): queue
 * depth, whether the queue is converging, the derived backlog alert, and
 * cursor recency. Read-only, rendered on the connection detail page's health
 * tab.
 *
 * Nested route prefix rather than a second bare @Controller('connections') -
 * the integrations module owns that prefix, and a duplicate would be a Nest
 * route-resolution ambiguity (the catalog-trust precedent).
 *
 * Deliberately touches no adapter, so it answers for a connection whose shop
 * is unreachable. There is no 404 for an unknown connection: the read is over
 * OpenLinker's own job rows, and an id with none is honestly 'idle'.
 *
 * @module apps/api/src/sync/http
 */
import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { ConnectionSyncStatus } from '@openlinker/core/sync';
import { CONNECTION_SYNC_STATUS_SERVICE_TOKEN , IConnectionSyncStatusService } from '@openlinker/core/sync';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ConnectionSyncStatusResponseDto } from './dto/connection-sync-status-response.dto';

@ApiBearerAuth()
@ApiTags('sync')
@Controller('connections/:connectionId/sync-status')
export class ConnectionSyncStatusController {
  constructor(
    @Inject(CONNECTION_SYNC_STATUS_SERVICE_TOKEN)
    private readonly syncStatusService: IConnectionSyncStatusService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: "Get a connection's sync queue status",
    description:
      'Reports queued, running and dead job counts for one connection, the measured arrival and ' +
      'drain rates, and a backlog alert whose threshold is derived from that connection\'s own ' +
      'drain rate rather than a fixed number. Makes no call to the shop.',
  })
  @ApiResponse({ status: 200, type: ConnectionSyncStatusResponseDto })
  async getSyncStatus(
    @Param('connectionId', ParseUUIDPipe) connectionId: string
  ): Promise<ConnectionSyncStatusResponseDto> {
    const status = await this.syncStatusService.getConnectionSyncStatus(connectionId);
    return this.toResponseDto(status);
  }

  private toResponseDto(status: ConnectionSyncStatus): ConnectionSyncStatusResponseDto {
    const dto = new ConnectionSyncStatusResponseDto();
    dto.connectionId = status.connectionId;
    dto.generatedAt = status.generatedAt.toISOString();
    dto.status = status.status;
    dto.alerting = status.alerting;
    dto.queuedCount = status.queuedCount;
    dto.runningCount = status.runningCount;
    dto.deadCount = status.deadCount;
    dto.arrivalRatePerHour = status.arrivalRatePerHour;
    dto.drainRatePerHour = status.drainRatePerHour;
    dto.alertThresholdJobs = status.alertThresholdJobs;
    dto.estimatedClearanceMs = status.estimatedClearanceMs;
    dto.oldestQueuedWaitMs = status.oldestQueuedWaitMs;
    dto.averageAttemptDurationMs = status.averageAttemptDurationMs;
    dto.attemptDurationSampleSize = status.attemptDurationSampleSize;
    dto.lastCursorAdvanceAt =
      status.lastCursorAdvanceAt === null ? null : status.lastCursorAdvanceAt.toISOString();
    dto.observationWindowMs = status.observationWindowMs;
    dto.alertHorizonMs = status.alertHorizonMs;
    return dto;
  }
}
