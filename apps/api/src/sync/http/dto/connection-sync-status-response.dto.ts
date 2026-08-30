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
      "Backlog status. 'idle' nothing due; 'draining' work due and converging; 'growing' not " +
      'converging but under the derived threshold, which is what a fresh sweep reads; ' +
      "'failing' nothing succeeded in the window and at least one job died; 'backlogged' the " +
      "alert; 'unknown' the counts could not be read.",
  })
  status!: ConnectionBacklogStatus;

  @ApiProperty({
    description:
      "True only for 'backlogged'. Requires all four of: the queue is not converging, it holds " +
      'more work than this connection drains in the alert horizon and more than an absolute ' +
      'floor, its oldest due job has already waited longer than that horizon, and something ' +
      'did succeed in the window.',
  })
  alerting!: boolean;

  @ApiProperty({
    description:
      'Jobs queued for this connection whose next run time has arrived. A job waiting on its ' +
      'own retry backoff is reported separately, as deferredCount.',
  })
  queuedCount!: number;

  @ApiProperty({ description: 'Jobs queued with a future run time - waiting on retry backoff' })
  deferredCount!: number;

  @ApiProperty({ description: 'Jobs currently running for this connection' })
  runningCount!: number;

  @ApiProperty({
    description:
      'Jobs that died inside the history window - they exhausted their retries. Windowed, so it ' +
      'clears with age rather than counting every death the connection ever had.',
  })
  deadCount!: number;

  @ApiProperty({ description: 'Jobs that died inside the observation window' })
  deadInWindow!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ISO timestamp of this connection\'s last successful job inside the history window, with ' +
      'business failures excluded. Null when it has none.',
  })
  lastSucceededAt!: string | null;

  @ApiProperty({ description: 'Jobs arriving per hour, measured over the observation window' })
  arrivalRatePerHour!: number;

  @ApiProperty({
    description:
      'Jobs SUCCEEDING per hour, measured over the observation window. Deaths are not drain.',
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
    description: 'How long the oldest due job has waited, in ms. Null when nothing is due.',
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

  @ApiProperty({ description: 'How far back the historical figures look, in ms' })
  historyWindowMs!: number;
}
