/**
 * Job Intake Consumer
 *
 * Consumes job requests from Redis Stream `jobs.sync` and persists them to the
 * database. Implements a long-polling consumer loop using Redis Streams consumer
 * groups with graceful shutdown support.
 *
 * @module apps/worker/src/sync
 */
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import type { SyncJobRequest, JobType } from '@openlinker/core/sync';
import {
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  JobTypeValues,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import {
  ackTrimmed,
  MAX_DRAIN_PAGES,
  MIN_RECLAIM_IDLE_MS,
  nextPendingCursor,
  readOwnPending,
  RECLAIM_INTERVAL_MS,
  reclaimOrphans,
  RecoveryAttemptTracker,
  resolveConsumerName,
  type StreamConsumerClient,
  type StreamEntry,
} from '@openlinker/shared/redis';

@Injectable()
export class JobIntakeConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobIntakeConsumer.name);
  private readonly STREAM_NAME = 'jobs.sync';
  private readonly CONSUMER_GROUP = 'job-intake';
  // Stable across restarts of the same logical worker and distinct across
  // replicas, so this process can reach its own pending history (#2164).
  private readonly CONSUMER_NAME = resolveConsumerName('job-intake');
  private readonly BLOCK_MS = 5000; // 5 seconds
  private readonly COUNT = 10; // Read up to 10 messages at a time
  // Must exceed p99 handler duration or a reclaim steals live work. The intake
  // handler is a single parse plus one insert, so the shared floor is already
  // orders of magnitude above it.
  private readonly RECLAIM_IDLE_MS = MIN_RECLAIM_IDLE_MS;

  private lastReclaimAt = 0;
  private readonly recoveryAttempts = new RecoveryAttemptTracker();

  private abortController: AbortController | null = null;
  private isRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    // Check if intake is enabled (default: true, can be disabled for tests)
    const enabled = this.configService.get<string>('WORKER_INTAKE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Job intake consumer disabled via WORKER_INTAKE_ENABLED=false');
      return;
    }

    await this.initializeConsumerGroup();
    await this.drainOwnPending();
    this.startConsumptionLoop();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumptionLoop();
  }

  /**
   * Initialize consumer group
   *
   * Creates the consumer group if it doesn't exist. Ignores BUSYGROUP error
   * if group already exists.
   */
  private async initializeConsumerGroup(): Promise<void> {
    try {
      // XGROUP CREATE stream group $ MKSTREAM
      // $ = start from new messages only
      // MKSTREAM = create stream if it doesn't exist
      await this.redisClient.xGroupCreate(this.STREAM_NAME, this.CONSUMER_GROUP, '$', {
        MKSTREAM: true,
      });
      this.logger.log(
        `Created consumer group ${this.CONSUMER_GROUP} for stream ${this.STREAM_NAME}`
      );
    } catch (error) {
      // Ignore BUSYGROUP error (group already exists)
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        this.logger.debug(`Consumer group ${this.CONSUMER_GROUP} already exists`);
      } else {
        this.logger.error(
          `Failed to create consumer group ${this.CONSUMER_GROUP}`,
          error instanceof Error ? error.stack : String(error)
        );
        throw error;
      }
    }
  }

  /**
   * Start consumption loop
   *
   * Starts a background loop that reads messages from the stream and processes them.
   * Uses AbortController for graceful shutdown.
   */
  private startConsumptionLoop(): void {
    this.abortController = new AbortController();
    this.isRunning = true;

    this.logger.log(
      `Starting job intake consumer loop (stream: ${this.STREAM_NAME}, group: ${this.CONSUMER_GROUP}, consumer: ${this.CONSUMER_NAME})`
    );

    // Start consumption loop in background (don't await)
    this.consumeLoop().catch((error) => {
      this.logger.error(
        'Consumption loop error',
        error instanceof Error ? error.stack : String(error)
      );
      // Restart loop after backoff (track timer for cleanup)
      if (this.isRunning) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.startConsumptionLoop();
        }, 5000);
        // Don't keep process alive if only this timer is running
        if (this.restartTimer && typeof this.restartTimer.unref === 'function') {
          this.restartTimer.unref();
        }
      }
    });
  }

  /**
   * Stop consumption loop
   *
   * Gracefully stops the consumption loop by setting isRunning to false and
   * aborting the AbortController signal.
   */
  private async stopConsumptionLoop(): Promise<void> {
    this.logger.log('Stopping consumption loop...');
    this.isRunning = false;
    this.abortController?.abort();

    // Clear restart timer if pending
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Wait a bit for in-flight messages to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.logger.log('Consumption loop stopped');
  }

  /**
   * Main consumption loop
   *
   * Continuously reads messages from the stream using XREADGROUP and processes them.
   * Uses blocking read with timeout to avoid busy-waiting.
   */
  private async consumeLoop(): Promise<void> {
    let lastHeartbeat = Date.now();
    const HEARTBEAT_INTERVAL_MS = 30000; // Log heartbeat every 30 seconds

    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // XREADGROUP GROUP group consumer COUNT count BLOCK milliseconds STREAMS stream >
        // > = read pending messages for this consumer, then new messages
        const messages = await this.redisClient.xReadGroup(
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          [
            {
              key: this.STREAM_NAME,
              id: '>', // Read new messages
            },
          ],
          {
            COUNT: this.COUNT,
            BLOCK: this.BLOCK_MS,
          }
        );

        // Log heartbeat periodically to show loop is alive
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          this.logger.debug(
            `Job intake consumer is running (waiting for jobs in stream: ${this.STREAM_NAME})`
          );
          lastHeartbeat = now;
        }

        // Before the empty-batch check: an idle stream is exactly when stranded
        // entries need recovering, so gating recovery on a batch arriving would
        // make it dead code in the case it exists for. Throttled internally.
        await this.maybeReclaimOrphans();

        if (!messages || messages.length === 0) {
          // No messages, continue loop
          continue;
        }

        // Process each message
        for (const stream of messages) {
          for (const message of stream.messages) {
            await this.processMessage(message.id, message.message);
          }
        }
      } catch (error) {
        // Handle abort signal (graceful shutdown)
        if (this.abortController?.signal.aborted) {
          this.logger.log('Consumption loop aborted');
          break;
        }

        // Handle Redis connection errors with longer backoff
        if (error instanceof Error && error.message.includes('Connection')) {
          this.logger.error('Redis connection error, will retry after longer backoff...');
          // Wait longer before retry for connection errors
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Log error and continue (retry on next iteration)
        this.logger.error(
          'Error in consumption loop',
          error instanceof Error ? error.stack : String(error)
        );

        // Backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single message
   *
   * Parses the job request from stream fields, validates job type, and persists
   * to database. ACKs the message only after successful persist.
   * Unknown jobType results in a `dead` job with error message.
   */
  private async processMessage(messageId: string, fields: Record<string, string>): Promise<void> {
    try {
      // Parse job request from stream fields
      const jobRequest = this.parseJobRequest(fields);

      // Validate job type
      const isValidJobType = this.isValidJobType(jobRequest.jobType);
      if (!isValidJobType) {
        // Unknown job type - persist as dead job
        this.logger.warn(`Unknown job type: ${jobRequest.jobType}. Persisting as dead job.`);
        await this.persistDeadJob(jobRequest, `Unknown job type: ${jobRequest.jobType}`);
        // ACK the message (we've handled it, even if it's invalid)
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return;
      }

      // Persist job to database (idempotent - repository handles duplicates)
      await this.jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType, // Already validated as valid JobType
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10, // Default max attempts (TODO: make configurable)
      });

      // ACK message only after successful persist
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Processed job request ${jobRequest.jobType} for ${jobRequest.connectionId} and persisted to database`
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${messageId}`,
        error instanceof Error ? error.stack : String(error)
      );

      // Classify errors - some should be ACKed to prevent infinite retry
      if (error instanceof Error) {
        // Invalid payload or malformed message - ACK and log as dead to prevent infinite retry
        if (
          error.message.includes('Invalid JSON') ||
          error.message.includes('Missing required fields')
        ) {
          this.logger.warn(
            `Invalid message format, persisting as dead job to prevent infinite retry: ${messageId}`
          );
          try {
            // Try to create a minimal dead job from available fields
            // Use a valid JobType as placeholder (repository requires valid JobType)
            const placeholderJobType: JobType = JobTypeValues[0]; // Use first valid job type as placeholder
            const deadJobRequest: SyncJobRequest = {
              jobType:
                fields.jobType && this.isValidJobType(fields.jobType)
                  ? fields.jobType
                  : placeholderJobType,
              connectionId: fields.connectionId || 'unknown',
              payload: { rawFields: fields, _parseError: error.message },
              idempotencyKey: fields.idempotencyKey || `invalid-${messageId}`,
            };
            await this.persistDeadJob(
              deadJobRequest,
              `Invalid message format: ${error instanceof Error ? error.message : String(error)}`
            );
          } catch (parseError) {
            this.logger.error(
              `Failed to persist invalid message as dead job: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
          // ACK to prevent infinite retry
          await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
          return;
        }
      }

      // Deliberately not ACKed: the entry stays in this consumer's Pending
      // Entries List. Redis never expires a PEL entry on its own, so recovery is
      // this consumer's own job — the startup drain (`drainOwnPending`) picks it
      // up on restart, and `maybeReclaimOrphans` claims it if this process
      // never returns. Before #2164 no code path read a PEL at all, and the
      // comment here claimed a redelivery timeout that does not exist, which is
      // why permanent message loss went unnoticed.
      throw error;
    }
  }

  /**
   * Drain this consumer's own pending history before reading new messages.
   *
   * `XPENDING` scoped to this consumer returns entries already delivered to it
   * and never ACKed — the messages a previous incarnation of this worker was holding
   * when it died. Without this they would sit in the PEL forever, because the
   * steady-state loop reads `'>'`, which returns only never-delivered entries.
   */
  private async drainOwnPending(): Promise<void> {
    let drained = 0;
    let cursor: string | undefined;

    try {
      for (let page = 0; ; page += 1) {
        if (page >= MAX_DRAIN_PAGES) {
          this.logger.warn(
            `Stopping startup drain after ${MAX_DRAIN_PAGES} pages; entries remain pending for ${this.CONSUMER_NAME}`
          );
          break;
        }
        if (this.abortController?.signal.aborted) {
          break;
        }

        const entries = await readOwnPending(
          this.redisClient as unknown as StreamConsumerClient,
          this.STREAM_NAME,
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          this.COUNT,
          cursor
        );

        if (entries.length === 0) {
          break;
        }

        // Counts entries actually handled, not entries attempted: a pass that
        // failed on half its page must not report them as recovered, since the
        // operator reading that line is reading it during the incident.
        for (const entry of entries) {
          if (await this.recoverEntrySafely(entry, 'startup-drain')) {
            drained += 1;
          }
        }

        // Advance past this page rather than re-reading from the oldest id. An
        // entry whose handler threw is still pending, so without this the same
        // page returns forever and the drain — which onModuleInit awaits —
        // stalls boot until the page cap. A failed entry is retried by the next
        // recovery pass, not by spinning inside this one.
        cursor = nextPendingCursor(entries) ?? cursor;
      }
    } catch (error) {
      // Never block startup on recovery: the steady-state loop is still correct
      // without it, and the periodic reclaim will retry the same entries.
      this.logger.error(
        'Failed to drain pending history; continuing to new messages',
        error instanceof Error ? error.stack : String(error)
      );
      return;
    }

    if (drained > 0) {
      this.logger.log(`Recovered ${drained} pending message(s) as ${this.CONSUMER_NAME}`);
    }
  }

  /**
   * Periodically claim entries stranded by a consumer that never came back.
   *
   * Stable identity lets a restarted process drain its own history; it cannot
   * help when a replica disappears permanently. An `XPENDING ... IDLE` + `XCLAIM`
   * pass covers that case, and only processes what the claim actually
   * transferred — an entry a live consumer still owns is left alone.
   */
  private async maybeReclaimOrphans(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReclaimAt < RECLAIM_INTERVAL_MS) {
      return;
    }
    this.lastReclaimAt = now;

    try {
      // Own failed messages first — the orphan pass below skips self-owned rows.
      const ownRetries = await readOwnPending(
        this.redisClient as unknown as StreamConsumerClient,
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        this.CONSUMER_NAME,
        this.COUNT
      );
      for (const entry of ownRetries) {
        await this.recoverEntrySafely(entry, 'pending-retry');
      }

      const entries = await reclaimOrphans(
        this.redisClient as unknown as StreamConsumerClient,
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        this.CONSUMER_NAME,
        this.RECLAIM_IDLE_MS,
        this.COUNT
      );

      for (const entry of entries) {
        await this.recoverEntrySafely(entry, 'orphan-reclaim');
      }
      const reclaimed = entries.length;

      if (reclaimed > 0) {
        this.logger.warn(
          `Reclaimed ${reclaimed} orphaned message(s) idle > ${this.RECLAIM_IDLE_MS}ms into ${this.CONSUMER_NAME}`
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to reclaim orphaned messages',
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  /**
   * Run one recovered entry, isolating a handler failure to that entry.
   *
   * Without this the enclosing try/catch spans the whole page loop, so a single
   * entry whose handler throws aborts the entire pass — and because the PEL is
   * always paged from the oldest id, that same entry leads every later drain and
   * reclaim. One poison message would permanently block recovery of every other
   * stranded message, which is the precise failure this recovery path exists to
   * prevent. The entry stays un-ACKed and is retried on the next pass; what does
   * not happen is its siblings being starved behind it.
   */
  private async recoverEntrySafely(entry: StreamEntry, source: string): Promise<boolean> {
    try {
      await this.handleRecoveredEntry(entry, source);
      this.recoveryAttempts.succeeded(entry.id);
      return true;
    } catch (error) {
      // A shutdown-time failure is not a handler failure: the client is quitting
      // and every later command would fail too. Rethrow so the enclosing pass
      // ends instead of grinding through the rest of the page against a dead
      // connection.
      if (this.abortController?.signal.aborted) {
        throw error;
      }

      const attempts = this.recoveryAttempts.recordFailure(entry.id);

      this.logger.error(
        `Failed to recover stream entry ${entry.id} (${source}, attempt ${attempts}); leaving it pending and continuing`,
        error instanceof Error ? error.stack : String(error)
      );

      // Once, on the crossing — a poison entry recurs by definition, so an
      // unguarded alarm per pass is alert fatigue. Auto-dead-lettering is
      // deliberately NOT done: two of the three consumers cannot build their
      // dead-letter payload from a raw pending entry (one needs a decoded
      // webhook event, one a parsed job request), and discarding it would be
      // unrecoverable loss. See ADR-049.
      if (this.recoveryAttempts.justCrossedThreshold(attempts)) {
        this.logger.error(
          `Stream entry ${entry.id} has now failed recovery ${attempts} times (${source}); it is stuck and needs manual intervention`
        );
      }

      return false;
    }
  }

  /**
   * Route one recovered entry, separating a trimmed id from real work.
   *
   * A trimmed entry keeps its PEL id after retention removed its data, so it has
   * no body to process. Routing it into `processMessage` would fail the
   * required-field check and persist a bogus dead `sync_jobs` row, inventing a
   * job that never existed — so it is ACKed to clear the dangling id instead.
   */
  private async handleRecoveredEntry(entry: StreamEntry, source: string): Promise<void> {
    if (entry.kind === 'trimmed') {
      this.logger.warn(
        `Discarding trimmed stream entry ${entry.id} (${source}): retention removed its data before it was processed`
      );
      await ackTrimmed(
        this.redisClient as unknown as StreamConsumerClient,
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        entry.id
      );
      return;
    }

    await this.processMessage(entry.id, entry.fields);
  }

  /**
   * Parse job request from stream fields
   *
   * Extracts jobType, connectionId, payloadJson, and idempotencyKey from stream fields.
   */
  private parseJobRequest(fields: Record<string, string>): SyncJobRequest {
    const jobType = fields.jobType;
    const connectionId = fields.connectionId;
    const payloadJson = fields.payloadJson;
    const idempotencyKey = fields.idempotencyKey;

    if (!jobType || !connectionId || !payloadJson || !idempotencyKey) {
      throw new Error(
        `Missing required fields in job request. Required: jobType, connectionId, payloadJson, idempotencyKey. Got: ${JSON.stringify(fields)}`
      );
    }

    let payload: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- redis stream payload is untyped; validated by the handler
      payload = JSON.parse(payloadJson) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Invalid JSON in payloadJson: ${payloadJson}`);
    }

    return {
      jobType: jobType as JobType, // Will be validated by isValidJobType
      connectionId,
      payload,
      idempotencyKey,
    };
  }

  /**
   * Validate job type
   *
   * Checks if the job type string is a valid JobType value.
   */
  private isValidJobType(value: string): value is JobType {
    return (JobTypeValues as readonly string[]).includes(value);
  }

  /**
   * Persist dead job for unknown job type
   *
   * Creates a job with status 'dead' and error message for unknown job types.
   * Uses a placeholder valid job type since the repository requires a valid JobType.
   */
  private async persistDeadJob(jobRequest: SyncJobRequest, errorMessage: string): Promise<void> {
    // Use a valid job type as placeholder (repository requires valid JobType)
    // Store the original invalid job type in the payload for debugging
    const placeholderJobType = JobTypeValues[0]; // Use first valid job type as placeholder

    const deadJob = await this.jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: placeholderJobType,
      connectionId: jobRequest.connectionId,
      payload: {
        ...jobRequest.payload,
        _originalJobType: jobRequest.jobType, // Preserve original for debugging
        _invalidJobType: true, // Flag to indicate this was an invalid job type
      },
      idempotencyKey: jobRequest.idempotencyKey,
      maxAttempts: 10,
    });

    // Only mark a freshly-created row dead. `createIfNotExistsByIdempotencyKey`
    // returns the existing row when one is already present, and startup drain /
    // orphan reclaim (#2164) make redelivery real — so an unguarded markDead
    // would flip a job that has since run to 'dead' on a repeat delivery.
    if (deadJob.status !== 'queued') {
      this.logger.warn(
        `Skipping markDead for ${deadJob.id}: job already in status '${deadJob.status}' (redelivered message)`
      );
      return;
    }

    await this.jobRepository.markDead(deadJob.id, errorMessage);
  }
}
