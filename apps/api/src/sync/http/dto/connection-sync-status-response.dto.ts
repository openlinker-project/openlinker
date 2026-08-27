/**
 * Connection Sync Status Response DTO
 *
 * Response shape for GET /connections/:connectionId/sync-status (#2615).
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ConnectionBacklogStatusValues } from '@openlinker/core/sync';
import { ConnectionBacklogStatus } from '@openlinker/core/sync';

export class ConnectionSyncStatusResponseDto {
  @ApiProperty({ description: 'Connection id' })
  connectionId!: string;

  @ApiProperty({ description: 'ISO timestamp this view was computed' })
  generatedAt!: string;

  @ApiProperty({
    enum: ConnectionBacklogStatusValues,
    description:
      "Backlog status. 'idle' nothing queued; 'draining' queued and converging (a fresh sweep " +
      "normally reads this); 'growing' not converging but under the derived threshold; " +
      "'backlogged' the alert; 'unknown' the counts could not be read.",
  })
  status!: ConnectionBacklogStatus;

  @ApiProperty({
    description:
      "True only for 'backlogged'. Requires all three of: the queue is not converging, it holds " +
      'more work than this connection drains in the alert horizon, and its oldest queued job has ' +
      'already waited longer than that horizon.',
  })
  alerting!: boolean;

  @ApiProperty({ description: 'Jobs currently queued for this connection' })
  queuedCount!: number;

  @ApiProperty({ description: 'Jobs currently running for this connection' })
  runningCount!: number;

  @ApiProperty({ description: 'Jobs in dead status - they exhausted their retries' })
  deadCount!: number;

  @ApiProperty({ description: 'Jobs arriving per hour, measured over the observation window' })
  arrivalRatePerHour!: number;

  @ApiProperty({
    description: 'Jobs reaching a terminal state per hour, measured over the observation window',
  })
  drainRatePerHour!: number;

  @ApiProperty({
    description:
      "The derived alert threshold in jobs: the work this connection drains in the alert horizon " +
      'at its own measured rate. Never a fixed number.',
  })
  alertThresholdJobs!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Estimated milliseconds to clear the queue at the measured net drain rate. Null when the ' +
      'queue is not converging and so has no estimated clearance at all.',
  })
  estimatedClearanceMs!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'How long the oldest queued job has waited, in ms. Null when nothing is queued.',
  })
  oldestQueuedWaitMs!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Mean duration of one execution attempt over the window, in ms, with rows carrying no ' +
      'recorded duration excluded rather than counted as zero. Null when nothing in the window ' +
      'carried one. This describes a single attempt - total time spent syncing cannot be built ' +
      'from it.',
  })
  averageAttemptDurationMs!: number | null;

  @ApiProperty({ description: 'How many rows backed averageAttemptDurationMs' })
  attemptDurationSampleSize!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "ISO timestamp of the last advance of any of this connection's sync cursors. Null when it " +
      'holds none, which is normal for a webhook-fed connection.',
  })
  lastCursorAdvanceAt!: string | null;

  @ApiProperty({ description: 'Observation window used for the rate figures, in ms' })
  observationWindowMs!: number;

  @ApiProperty({ description: 'Alert horizon used for the threshold and the wait test, in ms' })
  alertHorizonMs!: number;
}
