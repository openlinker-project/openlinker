/**
 * Connection Diagnostics Response DTO
 *
 * Aggregated operational summary for a single connection. Combines connection
 * status with recent sync job activity to give the FE a single read endpoint
 * for per-connection diagnostics.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';

export class RecentJobSummaryDto {
  @ApiProperty({ description: 'Job UUID' })
  id!: string;

  @ApiProperty({ description: 'Job type identifier' })
  jobType!: string;

  @ApiProperty({ description: 'Job status', example: 'succeeded' })
  status!: string;

  @ApiProperty({ description: 'Number of execution attempts' })
  attempts!: number;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiProperty({ description: 'Last error message, if any', nullable: true })
  lastError!: string | null;
}

export class ConnectionDiagnosticsResponseDto {
  @ApiProperty({ description: 'Connection UUID' })
  connectionId!: string;

  @ApiProperty({ description: 'Human-readable connection name' })
  connectionName!: string;

  @ApiProperty({ description: 'Connection status', example: 'active' })
  connectionStatus!: string;

  @ApiProperty({ description: 'Timestamp of last succeeded job (ISO 8601), or null if none', nullable: true })
  lastSucceededAt!: string | null;

  @ApiProperty({ description: 'Timestamp of last failed, dead, or retrying job with a recorded error (ISO 8601), or null if none', nullable: true })
  lastFailedAt!: string | null;

  @ApiProperty({ description: 'Error messages from recent failed jobs', type: [String] })
  recentErrors!: string[];

  @ApiProperty({ description: 'Last 10 sync jobs for this connection, newest first', type: [RecentJobSummaryDto] })
  recentJobs!: RecentJobSummaryDto[];

  static fromDomain(
    connection: Connection,
    recentJobs: SyncJob[],
  ): ConnectionDiagnosticsResponseDto {
    const dto = new ConnectionDiagnosticsResponseDto();
    dto.connectionId = connection.id;
    dto.connectionName = connection.name;
    dto.connectionStatus = connection.status;

    const succeededJobs = recentJobs.filter((j) => j.status === 'succeeded');
    // 'failed' status is never written — markFailed() re-queues jobs as 'queued'.
    // Capture dead jobs and any retrying job that has a recorded lastError.
    const failedJobs = recentJobs.filter((j) => j.status === 'dead' || j.lastError !== null);

    dto.lastSucceededAt = succeededJobs.length > 0
      ? new Date(succeededJobs[0].updatedAt).toISOString()
      : null;

    dto.lastFailedAt = failedJobs.length > 0
      ? new Date(failedJobs[0].updatedAt).toISOString()
      : null;

    dto.recentErrors = failedJobs
      .map((j) => j.lastError)
      .filter((e): e is string => e !== null && e !== undefined);

    dto.recentJobs = recentJobs.map((j) => {
      const jobDto = new RecentJobSummaryDto();
      jobDto.id = j.id;
      jobDto.jobType = j.jobType;
      jobDto.status = j.status;
      jobDto.attempts = j.attempts;
      jobDto.createdAt = new Date(j.createdAt).toISOString();
      jobDto.updatedAt = new Date(j.updatedAt).toISOString();
      jobDto.lastError = j.lastError ?? null;
      return jobDto;
    });

    return dto;
  }
}
