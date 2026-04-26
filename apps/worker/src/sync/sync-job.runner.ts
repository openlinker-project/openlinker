/**
 * Sync Job Runner
 *
 * Executes persisted sync jobs with retry logic and exponential backoff.
 * Continuously polls for due jobs, locks them atomically, executes handlers,
 * and manages job state transitions (queued → running → succeeded/failed/dead).
 *
 * @module apps/worker/src/sync
 */
import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  SyncJobEntity,
  SyncJobExecutionError,
} from '@openlinker/core/sync';
import { OfferCreationInvariantException } from '@openlinker/core/listings';
import {
  AllegroApiException,
  AllegroAuthenticationException,
} from '@openlinker/integrations-allegro';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { Logger } from '@openlinker/shared/logging';

// Deterministic Allegro 4xx — retrying never helps.
// Excludes 408/425 (transient by spec), 429 (raised as AllegroRateLimitException
// and handled with Retry-After inside the HTTP client), and 401 (handled below
// via AllegroAuthenticationException + token refresh).
const NON_RETRYABLE_ALLEGRO_STATUS_CODES = new Set([400, 403, 404, 405, 409, 415, 422]);

@Injectable()
export class SyncJobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncJobRunner.name);
  private readonly WORKER_ID = `worker-${process.pid}-${Date.now()}`;
  private readonly BATCH_SIZE = 10; // Number of jobs to process per iteration
  private readonly POLL_INTERVAL_MS = 1000; // Poll interval when no jobs available
  private readonly STUCK_JOB_TIMEOUT_MINUTES = 15; // Lock timeout for stuck jobs
  private readonly STUCK_JOB_RECOVERY_INTERVAL_MS = 5 * 60 * 1000; // Check for stuck jobs every 5 minutes

  // Retry policy constants
  private readonly RETRY_BASE_DELAY_SECONDS = 30; // 30 seconds
  private readonly RETRY_MAX_DELAY_SECONDS = 6 * 60 * 60; // 6 hours
  private readonly RETRY_MULTIPLIER = 2; // Exponential multiplier

  private abortController: AbortController | null = null;
  private isRunning = false;
  private stuckJobRecoveryInterval: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private runnerLoopPromise: Promise<void> | null = null;

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Check if runner is enabled (default: true, can be disabled for tests)
    const enabled = this.configService.get<string>('WORKER_RUNNER_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Sync job runner disabled via WORKER_RUNNER_ENABLED=false');
      return;
    }

    this.logger.log(`Starting sync job runner with worker ID: ${this.WORKER_ID}`);
    this.startRunner();
    this.startStuckJobRecovery();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopRunner();
  }

  /**
   * Start the runner loop
   */
  private startRunner(): void {
    // Prevent multiple starts
    if (this.runnerLoopPromise) {
      return;
    }

    this.abortController = new AbortController();
    this.isRunning = true;

    this.logger.log(`Starting sync job runner loop (worker: ${this.WORKER_ID}, batch size: ${this.BATCH_SIZE}, poll interval: ${this.POLL_INTERVAL_MS}ms)`);

    // Start runner loop in background (don't await)
    this.runnerLoopPromise = this.runnerLoop()
      .catch((error) => {
        this.logger.error('Runner loop error', error instanceof Error ? error.stack : String(error));
        // Restart loop after backoff (track timer for cleanup)
        if (this.isRunning) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.startRunner();
          }, 5000);
          // Don't keep process alive if only this timer is running
          if (this.restartTimer && typeof this.restartTimer.unref === 'function') {
            this.restartTimer.unref();
          }
        }
      })
      .finally(() => {
        this.runnerLoopPromise = null;
      });
  }

  /**
   * Stop the runner loop
   */
  private async stopRunner(): Promise<void> {
    this.logger.log('Stopping sync job runner...');
    this.isRunning = false;
    this.abortController?.abort();

    // Clear restart timer if pending
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Stop stuck job recovery
    if (this.stuckJobRecoveryInterval) {
      clearInterval(this.stuckJobRecoveryInterval);
      this.stuckJobRecoveryInterval = null;
    }

    // Wait for runner loop to finish, but with a timeout to prevent hanging
    const loopPromise = this.runnerLoopPromise;
    if (loopPromise) {
      await Promise.race([
        loopPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 500)), // 500ms safety timeout
      ]);
    }

    this.logger.log('Sync job runner stopped');
  }

  /**
   * Start stuck job recovery loop
   *
   * Periodically checks for and requeues jobs stuck in 'running' status
   * longer than the lock timeout threshold.
   *
   * @param intervalMs - Optional interval in milliseconds (defaults to STUCK_JOB_RECOVERY_INTERVAL_MS)
   */
  private startStuckJobRecovery(intervalMs?: number): void {
    // Prevent multiple starts
    if (this.stuckJobRecoveryInterval) {
      return;
    }

    const interval = intervalMs ?? this.STUCK_JOB_RECOVERY_INTERVAL_MS;
    this.stuckJobRecoveryInterval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const requeuedCount = await this.jobRepository.requeueStuckJobs(
            this.STUCK_JOB_TIMEOUT_MINUTES,
          );
          if (requeuedCount > 0) {
            this.logger.warn(`Requeued ${requeuedCount} stuck job(s)`);
          }
        } catch (error) {
          this.logger.error(
            'Error in stuck job recovery',
            error instanceof Error ? error.stack : String(error),
          );
        }
      })();
    }, interval);

    // Don't keep process alive if only this interval is running
    if (this.stuckJobRecoveryInterval && typeof this.stuckJobRecoveryInterval.unref === 'function') {
      this.stuckJobRecoveryInterval.unref();
    }

    this.logger.log(
      `Started stuck job recovery (checking every ${interval / 1000}s)`,
    );
  }

  /**
   * Main runner loop
   *
   * Continuously polls for due jobs, locks them, and executes them.
   */
  private async runnerLoop(): Promise<void> {
    let lastHeartbeat = Date.now();
    const HEARTBEAT_INTERVAL_MS = 30000; // Log heartbeat every 30 seconds

    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // Find and lock due jobs (atomic operation)
        const jobs = await this.jobRepository.findAndLockDueJobs(
          this.BATCH_SIZE,
          this.WORKER_ID,
        );

        // Log heartbeat periodically to show loop is alive
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          this.logger.debug(`Sync job runner is running (polling for queued jobs every ${this.POLL_INTERVAL_MS}ms)`);
          lastHeartbeat = now;
        }

        // Handle case where repository returns undefined (shouldn't happen, but defensive)
        if (!jobs || jobs.length === 0) {
          // No jobs available, wait before next poll (abortable sleep)
          await this.sleep(this.POLL_INTERVAL_MS, this.abortController?.signal);
          continue;
        }

        this.logger.debug(`Found ${jobs.length} due job(s), processing...`);

        // Process jobs in parallel (or sequentially for better error isolation)
        // For MVP, process sequentially to avoid overwhelming adapters
        for (const job of jobs) {
          await this.processJob(job);
        }
      } catch (error) {
        // Handle abort signal (graceful shutdown)
        if (this.abortController?.signal.aborted) {
          this.logger.log('Runner loop aborted');
          break;
        }

        // Log error and continue (retry on next iteration)
        this.logger.error(
          'Error in runner loop',
          error instanceof Error ? error.stack : String(error),
        );

        // Backoff before retrying (abortable sleep)
        await this.sleep(1000, this.abortController?.signal);
      }
    }
  }

  /**
   * Process a single job
   *
   * Executes the job handler and updates job status based on result.
   * Never throws - always marks job as succeeded, failed, or dead.
   */
  private async processJob(job: SyncJobEntity): Promise<void> {
    this.logger.debug(
      `Processing job ${job.id} (${job.jobType}) for connection ${job.connectionId} (attempt ${job.attempts + 1}/${job.maxAttempts})`,
    );

    try {
      // Get handler for job type
      const handler = this.handlerRegistry.getHandler(job.jobType);

      if (!handler) {
        // No handler registered - mark as dead
        const errorMessage = `No handler registered for job type: ${job.jobType}`;
        this.logger.error(`Job ${job.id}: ${errorMessage}`);
        await this.jobRepository.markDead(job.id, errorMessage);
        return;
      }

      // Execute handler — handlers return their business outcome (issue #400)
      const result = await handler.execute(job);

      // Success - mark as succeeded with the handler's reported outcome
      await this.jobRepository.markSucceeded(job.id, result.outcome);
      this.logger.log(
        `Job ${job.id} (${job.jobType}) succeeded with outcome=${result.outcome} after ${job.attempts + 1} attempt(s)`,
      );
    } catch (error) {
      // Handle execution error
      await this.handleJobFailure(job, error);
    }
  }

  /**
   * Handle job execution failure
   *
   * Determines whether to retry (markFailed) or mark as dead (maxAttempts reached).
   * Calculates exponential backoff for retries.
   *
   * Authentication errors (401) are marked as dead immediately since they require
   * manual intervention (token refresh) and won't resolve with retries.
   */
  private async handleJobFailure(job: SyncJobEntity, error: unknown): Promise<void> {
    const errorMessage = this.extractErrorMessage(error);
    const nextAttempt = job.attempts + 1;

    this.logger.error(
      `Job ${job.id} (${job.jobType}) failed on attempt ${nextAttempt}/${job.maxAttempts}: ${errorMessage}`,
      error instanceof Error ? error.stack : undefined,
    );

    // Check for non-retryable errors (authentication failures)
    if (this.isNonRetryableError(error)) {
      await this.jobRepository.markDead(job.id, errorMessage);
      this.logger.warn(
        `Job ${job.id} (${job.jobType}) marked as dead due to non-retryable error`,
      );
      return;
    }

    // Check if max attempts reached
    if (nextAttempt >= job.maxAttempts) {
      // Max attempts reached - mark as dead
      await this.jobRepository.markDead(job.id, errorMessage);
      this.logger.warn(
        `Job ${job.id} (${job.jobType}) marked as dead after ${nextAttempt} attempt(s)`,
      );
      return;
    }

    // Calculate exponential backoff
    const backoffSeconds = this.calculateBackoff(nextAttempt);
    const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

    // Mark as failed and schedule retry
    await this.jobRepository.markFailed(job.id, errorMessage, nextRunAt);
    this.logger.debug(
      `Job ${job.id} (${job.jobType}) scheduled for retry in ${backoffSeconds}s (attempt ${nextAttempt + 1}/${job.maxAttempts})`,
    );
  }

  /**
   * Check if error is non-retryable (requires manual intervention or a code change).
   *
   * Non-retryable cases:
   * - AllegroAuthenticationException (401) — needs token refresh, not retry.
   * - AllegroApiException with a status in NON_RETRYABLE_ALLEGRO_STATUS_CODES —
   *   deterministic 4xx (e.g., 415 unsupported content type, 422 validation) where
   *   retrying burns worker capacity and masks the real issue.
   *
   * Retryable cases intentionally left out:
   * - MissingOrderItemMappingError — offer→variant mappings are created by a separate
   *   sync cadence and may simply not exist yet when the order job first fires.
   * - AllegroApiException with 5xx / 408 / 425 — transient; the HTTP client already
   *   retries internally, and the runner gives the job more attempts.
   *
   * @param error - Error to check
   * @returns True if error is non-retryable
   */
  private isNonRetryableError(error: unknown): boolean {
    const cause =
      error instanceof SyncJobExecutionError && error.cause ? error.cause : error;

    // OfferCreationInvariantException is a code bug (orchestrator returned with a
    // record still in 'pending'). Retries cannot fix it — the next attempt would
    // hit the same code path. Mark dead immediately so the operator can see it.
    // See issue #400 (Plan B for #391).
    if (cause instanceof OfferCreationInvariantException) {
      return true;
    }

    // AllegroAuthenticationException extends Error directly (not AllegroApiException),
    // so the two branches are disjoint: a 401 never reaches the status-code set below.
    if (cause instanceof AllegroAuthenticationException) {
      return true;
    }

    if (
      cause instanceof AllegroApiException &&
      cause.statusCode !== undefined &&
      NON_RETRYABLE_ALLEGRO_STATUS_CODES.has(cause.statusCode)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate exponential backoff delay
   *
   * Formula: baseDelay * (multiplier ^ (attemptNumber - 1))
   * Capped at maxDelay.
   *
   * Examples:
   * - Attempt 1: 30s
   * - Attempt 2: 60s (30 * 2^1)
   * - Attempt 3: 120s (30 * 2^2)
   * - Attempt 4: 240s (30 * 2^3)
   * - Attempt 5: 480s (30 * 2^4)
   * - Attempt 6+: capped at 6h
   *
   * @param attemptNumber - Current attempt number (1-based)
   * @returns Backoff delay in seconds
   */
  private calculateBackoff(attemptNumber: number): number {
    // attemptNumber is 1-based (first attempt = 1)
    // For attempt 1, we want baseDelay (30s)
    // For attempt 2, we want baseDelay * multiplier (60s)
    // Formula: baseDelay * (multiplier ^ (attemptNumber - 1))
    const delay =
      this.RETRY_BASE_DELAY_SECONDS *
      Math.pow(this.RETRY_MULTIPLIER, attemptNumber - 1);

    // Cap at max delay
    return Math.min(delay, this.RETRY_MAX_DELAY_SECONDS);
  }

  /**
   * Extract error message from error object
   *
   * Handles various error types and extracts a meaningful message.
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof SyncJobExecutionError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Abortable sleep helper
   *
   * Sleeps for the specified duration, but can be cancelled via AbortSignal.
   * If the signal is aborted, resolves immediately.
   *
   * @param ms - Milliseconds to sleep
   * @param signal - Optional AbortSignal to cancel the sleep
   * @returns Promise that resolves when sleep completes or is aborted
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      // If already aborted, resolve immediately
      if (signal?.aborted) {
        resolve();
        return;
      }

      const timeout = setTimeout(resolve, ms);

      // If signal provided, listen for abort
      if (signal) {
        const onAbort = (): void => {
          clearTimeout(timeout);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

