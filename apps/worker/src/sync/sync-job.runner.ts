/**
 * Sync Job Runner
 *
 * Executes persisted sync jobs with retry logic and exponential backoff.
 * Continuously polls for due jobs, locks them atomically, executes handlers,
 * and manages job state transitions (queued → running → succeeded/failed/dead).
 *
 * @module apps/worker/src/sync
 */
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SyncJobEntity, SyncJobHandlerResult } from '@openlinker/core/sync';
import {
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  SyncJobExecutionError,
  RetryClassifierRegistryService,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  AuthFailureClassifierRegistryService,
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { OfferCreationInvariantException } from '@openlinker/core/listings';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { Logger } from '@openlinker/shared/logging';
import { runWithPriority, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

@Injectable()
export class SyncJobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncJobRunner.name);
  private readonly WORKER_ID = `worker-${process.pid}-${Date.now()}`;
  private readonly BATCH_SIZE = 10; // Number of jobs to process per iteration
  private readonly POLL_INTERVAL_MS = 1000; // Poll interval when no jobs available
  private readonly JOB_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000; // Refresh lockedAt every 3 minutes while a job runs (#1810)
  private readonly RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS = 30; // Fixed short requeue delay for RateLimitTimeoutError — not exponential, since attempts never increments (#1810 review follow-up)

  // Retry policy constants
  private readonly RETRY_BASE_DELAY_SECONDS = 30; // 30 seconds
  private readonly RETRY_MAX_DELAY_SECONDS = 6 * 60 * 60; // 6 hours
  private readonly RETRY_MULTIPLIER = 2; // Exponential multiplier

  private abortController: AbortController | null = null;
  private isRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private runnerLoopPromise: Promise<void> | null = null;

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    private readonly handlerRegistry: SyncJobHandlerRegistry,
    private readonly configService: ConfigService,
    @Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)
    private readonly retryClassifierRegistry: RetryClassifierRegistryService,
    @Inject(AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN)
    private readonly authFailureClassifierRegistry: AuthFailureClassifierRegistryService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort
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
    // Stuck-job recovery moved to StuckJobRecoveryService (`maintenance` role,
    // #2279) — a runner replica no longer doubles as the fleet's janitor.
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

    this.logger.log(
      `Starting sync job runner loop (worker: ${this.WORKER_ID}, batch size: ${this.BATCH_SIZE}, poll interval: ${this.POLL_INTERVAL_MS}ms)`
    );

    // Start runner loop in background (don't await)
    this.runnerLoopPromise = this.runnerLoop()
      .catch((error) => {
        this.logger.error(
          'Runner loop error',
          error instanceof Error ? error.stack : String(error)
        );
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
        const jobs = await this.jobRepository.findAndLockDueJobs(this.BATCH_SIZE, this.WORKER_ID);

        // Log heartbeat periodically to show loop is alive
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          this.logger.debug(
            `Sync job runner is running (polling for queued jobs every ${this.POLL_INTERVAL_MS}ms)`
          );
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
          error instanceof Error ? error.stack : String(error)
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
      `Processing job ${job.id} (${job.jobType}) for connection ${job.connectionId} (attempt ${job.attempts + 1}/${job.maxAttempts})`
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

      // Heartbeat while the handler runs so a job queued behind a saturated
      // per-connection rate limiter for longer than STUCK_JOB_TIMEOUT_MINUTES
      // is not duplicated by the stuck-job recovery sweep (#1810).
      const heartbeatInterval = setInterval(() => {
        void this.jobRepository.heartbeat(job.id, this.WORKER_ID).catch((error) => {
          this.logger.warn(
            `Heartbeat failed for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      }, this.JOB_HEARTBEAT_INTERVAL_MS);
      if (typeof heartbeatInterval.unref === 'function') {
        heartbeatInterval.unref();
      }

      let result: SyncJobHandlerResult;
      try {
        // Execute handler — handlers return their business outcome (issue #400).
        // Runs under the 'background' rate-limit priority (#1810) so any
        // outbound HTTP the handler issues through HostServices.http is
        // classified correctly without threading a parameter through
        // SyncJobHandler.execute or any adapter signature. Cancellable via
        // the runner's own shutdown signal.
        result = await runWithPriority(
          { priority: 'background', signal: this.abortController?.signal },
          () => handler.execute(job)
        );
      } finally {
        clearInterval(heartbeatInterval);
      }

      // Success - mark as succeeded with the handler's reported outcome
      await this.jobRepository.markSucceeded(job.id, result.outcome, result.outcomeReason);
      this.logger.log(
        `Job ${job.id} (${job.jobType}) succeeded with outcome=${result.outcome} after ${job.attempts + 1} attempt(s)`
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

    // Rate-limit-queue timeout (#1810 review follow-up on #1957): congestion
    // on a shared per-connection limiter is not the job's own failure, so it
    // must not burn a retry attempt or eventually markDead the job purely
    // because a resource was busy. Checked BEFORE the attempts/non-retryable
    // logic below — unwraps SyncJobExecutionError.cause the same way
    // isNonRetryableError() does, since a handler may wrap the original
    // RateLimitTimeoutError before it reaches the runner.
    if (this.isRateLimitTimeout(error)) {
      const nextRunAt = new Date(
        Date.now() + this.RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS * 1000
      );
      await this.jobRepository.requeueWithoutPenalty(job.id, errorMessage, nextRunAt);
      this.logger.warn(
        `Job ${job.id} (${job.jobType}) timed out waiting for a rate-limit slot — requeued in ` +
          `${this.RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS}s without counting against maxAttempts ` +
          `(attempt stays ${job.attempts}/${job.maxAttempts})`
      );
      return;
    }

    const nextAttempt = job.attempts + 1;

    this.logger.error(
      `Job ${job.id} (${job.jobType}) failed on attempt ${nextAttempt}/${job.maxAttempts}: ${errorMessage}`,
      error instanceof Error ? error.stack : undefined
    );

    // Check for non-retryable errors (authentication failures)
    if (this.isNonRetryableError(error)) {
      // A terminal *credential rejection* (e.g. Allegro `invalid_grant` on
      // token refresh) flags the originating connection for re-authentication
      // (#819). This is the narrow `credential-rejected` subset of
      // non-retryable errors — a deterministic 422 validation failure is also
      // non-retryable but must NOT flag the connection. Transient
      // `network-failure` during refresh is surfaced as a retryable exception
      // and never reaches this branch.
      const cause = error instanceof SyncJobExecutionError && error.cause ? error.cause : error;
      if (this.authFailureClassifierRegistry.isCredentialRejected(cause)) {
        await this.flagConnectionNeedsReauth(job.connectionId);
      }
      await this.jobRepository.markDead(job.id, errorMessage);
      this.logger.warn(`Job ${job.id} (${job.jobType}) marked as dead due to non-retryable error`);
      return;
    }

    // Check if max attempts reached
    if (nextAttempt >= job.maxAttempts) {
      // Max attempts reached - mark as dead
      await this.jobRepository.markDead(job.id, errorMessage);
      this.logger.warn(
        `Job ${job.id} (${job.jobType}) marked as dead after ${nextAttempt} attempt(s)`
      );
      return;
    }

    // Calculate exponential backoff
    const backoffSeconds = this.calculateBackoff(nextAttempt);
    const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

    // Mark as failed and schedule retry
    await this.jobRepository.markFailed(job.id, errorMessage, nextRunAt);
    this.logger.debug(
      `Job ${job.id} (${job.jobType}) scheduled for retry in ${backoffSeconds}s (attempt ${nextAttempt + 1}/${job.maxAttempts})`
    );
  }

  /**
   * Check if error is non-retryable (requires manual intervention or a
   * code change).
   *
   * Two paths:
   *   1. `OfferCreationInvariantException` — kept inline. Core exception
   *      from `@openlinker/core/listings`, no platform coupling. It's a
   *      code bug (orchestrator returned with a record still in 'pending'),
   *      retries cannot fix it. See issue #400 (Plan B for #391).
   *   2. Everything else — delegated to `RetryClassifierRegistryService`,
   *      which OR's across registered platform classifiers (#581). The
   *      Allegro classifier owns Allegro's exception hierarchy
   *      (`AllegroAuthenticationException`, deterministic 4xx via
   *      `AllegroApiException`); future Shopify / WooCommerce plugins
   *      register their own.
   *
   * The runner unwraps `SyncJobExecutionError.cause` once before either
   * path, so per-platform classifiers see the original platform exception
   * directly.
   *
   * Retryable cases intentionally left out (registry classifiers must
   * also leave them out):
   *   - `MissingOrderItemMappingError` — offer→variant mappings are
   *     created by a separate sync cadence and may simply not exist yet
   *     when the order job first fires.
   *
   * @param error - Error to check
   * @returns True if error is non-retryable
   */
  private isNonRetryableError(error: unknown): boolean {
    const cause = error instanceof SyncJobExecutionError && error.cause ? error.cause : error;

    if (cause instanceof OfferCreationInvariantException) {
      return true;
    }

    return this.retryClassifierRegistry.isNonRetryable(cause);
  }

  /**
   * Detect a `RateLimitTimeoutError` (#1810 review follow-up on #1957) —
   * checked ahead of {@link isNonRetryableError} in {@link handleJobFailure}
   * so it's routed to a penalty-free requeue instead of `markFailed`/`markDead`.
   * Unwraps `SyncJobExecutionError.cause` the same way `isNonRetryableError`
   * does, since a handler may re-throw the original error wrapped.
   */
  private isRateLimitTimeout(error: unknown): boolean {
    const cause = error instanceof SyncJobExecutionError && error.cause ? error.cause : error;
    return cause instanceof RateLimitTimeoutError;
  }

  /**
   * Flag a connection as needing re-authentication after a terminal credential
   * rejection (#819).
   *
   * Only flips a connection that is currently `active`: we never clobber an
   * admin-set `disabled`, never re-write an already-flagged connection, and
   * never thrash on the repeated failures that a dead-credentials connection
   * produces. Once flagged, the scheduler's `status: 'active'` filter stops
   * enqueuing new jobs against it until a successful re-auth flips it back.
   *
   * Best-effort by design: a failure here must never mask the original job
   * failure or break the runner loop, so errors are logged and swallowed.
   */
  private async flagConnectionNeedsReauth(connectionId: string): Promise<void> {
    try {
      const connection = await this.connectionPort.get(connectionId);
      if (connection.status !== 'active') {
        return;
      }
      await this.connectionPort.update(connectionId, { status: 'needs_reauth' });
      this.logger.warn(
        `Connection ${connectionId} (${connection.platformType}) flagged needs_reauth ` +
          `after a terminal credential rejection — scheduler will stop enqueuing jobs ` +
          `against it until re-authentication`
      );
    } catch (error) {
      this.logger.error(
        `Failed to flag connection ${connectionId} as needs_reauth`,
        error instanceof Error ? error.stack : String(error)
      );
    }
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
      this.RETRY_BASE_DELAY_SECONDS * Math.pow(this.RETRY_MULTIPLIER, attemptNumber - 1);

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
