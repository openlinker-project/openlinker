/**
 * Analytics Trust Response DTO
 *
 * Response shape for GET /analytics/trust — the analytics data-trust
 * snapshot (#1982). Dates are serialised as ISO 8601 strings. Explicit
 * field-by-field projection rather than a spread of the core snapshot, per
 * engineering-standards.md's response-shape allowlist convention.
 *
 * @module apps/api/src/analytics-trust/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ConnectionIngestionStatusValues } from '@openlinker/core/analytics-trust';
import type { ConnectionIngestionStatus } from '@openlinker/core/analytics-trust';

export class ConnectionIngestionTrustResponseDto {
  @ApiProperty({ description: 'Connection UUID' })
  connectionId!: string;

  @ApiProperty({ description: 'Human-readable connection name' })
  connectionName!: string;

  @ApiProperty({ description: "Connection's platform type (e.g. 'allegro', 'prestashop')" })
  platformType!: string;

  @ApiProperty({
    enum: ConnectionIngestionStatusValues,
    description:
      "'never-ingested' = no succeeded ingestion job has ever run; 'stalled' = the last succeeded " +
      "ingestion job is older than this connection's staleness threshold; 'fresh' = otherwise.",
  })
  status!: ConnectionIngestionStatus;

  @ApiProperty({
    nullable: true,
    description:
      'Completion time (ISO 8601) of the most recently succeeded ingestion job, or null when never-ingested.',
  })
  lastSuccessfulIngestionAt!: string | null;

  @ApiProperty({
    description:
      "Start of this connection's coverage window (ISO 8601) — the connection's own creation time.",
  })
  coverageStartAt!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Expected interval (ms) between successful ingestion ticks, derived from the registered poll ' +
      'cadence. Null when no matching scheduler task is registered for this platform.',
  })
  expectedIntervalMs!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Staleness threshold (ms). Null when expectedIntervalMs is null.',
  })
  staleAfterMs!: number | null;
}

export class AnalyticsTrustResponseDto {
  @ApiProperty({ description: 'Time (ISO 8601) this snapshot was computed' })
  generatedAt!: string;

  @ApiProperty({
    type: [ConnectionIngestionTrustResponseDto],
    description: 'One entry per active OrderSource-capable connection. Empty on a day-one instance.',
  })
  connections!: ConnectionIngestionTrustResponseDto[];
}
