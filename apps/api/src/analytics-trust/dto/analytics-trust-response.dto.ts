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
import { ConnectionIngestionStatus } from '@openlinker/core/analytics-trust';
import { ConnectionStatusValues } from '@openlinker/core/identifier-mapping';
import { ConnectionStatus } from '@openlinker/core/identifier-mapping';

export class ConnectionIngestionTrustResponseDto {
  @ApiProperty({ description: 'Connection UUID' })
  connectionId!: string;

  @ApiProperty({ description: 'Human-readable connection name' })
  connectionName!: string;

  @ApiProperty({ description: "Connection's platform type (e.g. 'allegro', 'prestashop')" })
  platformType!: string;

  @ApiProperty({
    enum: ConnectionStatusValues,
    description:
      "This connection's own current status, carried through unchanged so a 'disconnected' " +
      'status entry can tell the operator why (e.g. an expired Allegro token flipped it to ' +
      "'needs_reauth').",
  })
  connectionStatus!: ConnectionStatus;

  @ApiProperty({
    enum: ConnectionIngestionStatusValues,
    description:
      "'disconnected' when connectionStatus is not 'active' — takes priority over poll history. " +
      'Otherwise derived from lastPollAt vs. staleAfterMs — pipe liveness, not data recency. ' +
      "'never-ingested' = no succeeded marketplace.orders.poll job has ever run; 'stalled' = the last " +
      "succeeded poll job is older than this connection's staleness threshold; 'fresh' = otherwise; " +
      "'unknown' = this entry could not be computed (e.g. a transient error) — distinct from " +
      "'never-ingested' on purpose, since that would otherwise be a false claim about the operator's data.",
  })
  status!: ConnectionIngestionStatus;

  @ApiProperty({
    nullable: true,
    description:
      'Completion time (ISO 8601) of the most recently succeeded marketplace.orders.poll job, or null ' +
      'if it has never succeeded. A liveness signal for the ingestion pipe itself, not proof that any ' +
      'order data has arrived — see lastOrderIngestedAt for that.',
  })
  lastPollAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Completion time (ISO 8601) of the most recently succeeded marketplace.order.sync job for this ' +
      'connection, or null if none has ever succeeded. The actual order-data-recency signal — ' +
      'deliberately not thresholded against staleAfterMs, since a low-volume connection can go days ' +
      'without a new order and still be healthy.',
  })
  lastOrderIngestedAt!: string | null;

  @ApiProperty({
    description:
      "This connection's own creation time (ISO 8601) — when the operator configured it, not a claim " +
      'about when its earliest order data begins.',
  })
  connectionCreatedAt!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Earliest ingested order date (ISO 8601) for this connection — MIN(placedAt) falling back to ' +
      'createdAt for pre-#1985 rows. Null when the connection has zero ingested orders. The real ' +
      'per-channel coverage-window fact; do not confuse with connectionCreatedAt.',
  })
  earliestOrderDate!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Expected interval (ms) between poll ticks, derived from the registered, currently-enabled poll ' +
      'cadence. Null when no matching, enabled scheduler task is registered for this platform.',
  })
  expectedIntervalMs!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Staleness threshold (ms). Falls back to a floor value when expectedIntervalMs is null ' +
      '(cadence unknown) rather than leaving the connection unstaleable forever.',
  })
  staleAfterMs!: number | null;
}

export class AnalyticsTrustResponseDto {
  @ApiProperty({ description: 'Time (ISO 8601) this snapshot was computed' })
  generatedAt!: string;

  @ApiProperty({
    enum: ConnectionIngestionStatusValues,
    description:
      'The single worst status across `connections`, so a caller can render one banner without ' +
      "re-deriving the severity ordering itself. 'fresh' when there are no connections.",
  })
  worstStatus!: ConnectionIngestionStatus;

  @ApiProperty({
    type: [ConnectionIngestionTrustResponseDto],
    description:
      'One entry per OrderSource-capable connection, regardless of its status — a disabled or ' +
      "needs_reauth connection is included with status 'disconnected', not omitted. Empty on a " +
      'day-one instance.',
  })
  connections!: ConnectionIngestionTrustResponseDto[];
}
