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

export class ActiveOrderImportDto {
  @ApiProperty({ description: 'Identifies the import run' })
  runId!: string;

  @ApiProperty({ enum: ['oldest-first', 'newest-first'] })
  direction!: 'oldest-first' | 'newest-first';

  @ApiProperty({ nullable: true, type: String, description: 'First day of the window, or null' })
  from!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Last day of the window, or null' })
  to!: string | null;

  @ApiProperty({ description: 'Pages read so far. The total is unknown.' })
  pagesDone!: number;

  @ApiProperty({ description: 'ISO timestamp the run started' })
  startedAt!: string;
}

export class OrderImportFailureReasonDto {
  @ApiProperty({ enum: ['missing-mapping', 'other'], description: 'Why the orders could not be imported' })
  code!: 'missing-mapping' | 'other';

  @ApiProperty({ description: 'Orders that failed for this reason in the last 7 days' })
  count!: number;

  @ApiProperty({ description: 'ISO timestamp of the most recent failure' })
  lastFailedAt!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Source id of the most recent order that failed' })
  sampleOrderId!: string | null;

  @ApiProperty({ description: 'Stored message of that failure, verbatim (English)' })
  sampleMessage!: string;
}

export class OrderStartStatusDto {
  @ApiProperty({ enum: ['now', 'from', 'all'], description: 'Which orders import starts with' })
  mode!: 'now' | 'from' | 'all';

  @ApiProperty({ nullable: true, type: String, description: 'First day, for mode "from"' })
  from!: string | null;

  @ApiProperty({ enum: ['oldest-first', 'newest-first'], description: 'Which end of the history is imported first' })
  order!: 'oldest-first' | 'newest-first';

  @ApiProperty({ nullable: true, type: String, description: 'ISO timestamp the choice took effect; null while it waits for the next check' })
  appliedAt!: string | null;

  @ApiProperty({ description: 'True when the choice was made and nothing has been read under it yet' })
  pending!: boolean;
}

export class OrderImportStatusDto {
  @ApiProperty({ description: 'Orders imported in the last 24 hours' })
  importedLast24h!: number;

  @ApiProperty({ nullable: true, type: String, description: 'ISO timestamp of the last successful poll of the shop for orders (last 7 days), or null' })
  lastPolledAt!: string | null;

  @ApiProperty({ description: 'Order imports that failed for good in the last 7 days' })
  failedLast7d!: number;

  @ApiProperty({ type: [OrderImportFailureReasonDto], description: 'The failures grouped by reason' })
  failures!: OrderImportFailureReasonDto[];

  @ApiProperty({ description: 'Order imports queued or running right now' })
  waiting!: number;

  @ApiProperty({ nullable: true, type: String, description: 'When an order was last imported (last 7 days), or null' })
  lastImportedAt!: string | null;

  @ApiProperty({ nullable: true, type: ActiveOrderImportDto, description: 'A history or range import that is still running, or null' })
  activeImport!: ActiveOrderImportDto | null;
}

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

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ISO timestamp at which order sync was started from "now" for this connection. Null when ' +
      'no start was recorded (a connection that predates start dates, or one with no order feed).',
  })
  orderSyncStartedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: OrderImportStatusDto,
    description: 'How the order import is doing. Null when the figures could not be read.',
  })
  orderImport!: OrderImportStatusDto | null;

  @ApiProperty({
    nullable: true,
    type: OrderStartStatusDto,
    description: 'The start choice for order import, or null when none was recorded.',
  })
  orderStart!: OrderStartStatusDto | null;

  @ApiProperty({ description: 'Observation window used for the rate figures, in ms' })
  observationWindowMs!: number;

  @ApiProperty({ description: 'Alert horizon used for the threshold and the wait test, in ms' })
  alertHorizonMs!: number;

  @ApiProperty({ description: 'How far back the historical figures look, in ms' })
  historyWindowMs!: number;
}
