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
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import { Logger } from '@openlinker/shared/logging';

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
    this.abortController = new AbortController();
    this.isRunning = true;

    // Start runner loop in background (don't await)
    this.runnerLoop().catch((error) => {
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

    // Wait a bit for in-flight jobs to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.logger.log('Sync job runner stopped');
  }

  /**
   * Start stuck job recovery loop
   *
   * Periodically checks for and requeues jobs stuck in 'running' status
   * longer than the lock timeout threshold.
   */
  private startStuckJobRecovery(): void {
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
    }, this.STUCK_JOB_RECOVERY_INTERVAL_MS);

    // Don't keep process alive if only this interval is running
    if (this.stuckJobRecoveryInterval && typeof this.stuckJobRecoveryInterval.unref === 'function') {
      this.stuckJobRecoveryInterval.unref();
    }

    this.logger.log(
      `Started stuck job recovery (checking every ${this.STUCK_JOB_RECOVERY_INTERVAL_MS / 1000}s)`,
    );
  }

  /**
   * Main runner loop
   *
   * Continuously polls for due jobs, locks them, and executes them.
   */
  private async runnerLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // Find and lock due jobs (atomic operation)
        const jobs = await this.jobRepository.findAndLockDueJobs(
          this.BATCH_SIZE,
          this.WORKER_ID,
        );

        // Handle case where repository returns undefined (shouldn't happen, but defensive)
        if (!jobs || jobs.length === 0) {
          // No jobs available, wait before next poll
          await new Promise((resolve) => setTimeout(resolve, this.POLL_INTERVAL_MS));
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

        // Backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single job
   *
   * Executes the job handler and updates job status based on result.
   * Never throws - always marks job as succeeded, failed, or dead.
   */
  private async processJob(job: SyncJob): Promise<void> {
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

      // Execute handler
      await handler.execute(job);

      // Success - mark as succeeded
      await this.jobRepository.markSucceeded(job.id);
      this.logger.log(
        `Job ${job.id} (${job.jobType}) succeeded after ${job.attempts + 1} attempt(s)`,
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
   */
  private async handleJobFailure(job: SyncJob, error: unknown): Promise<void> {
    const errorMessage = this.extractErrorMessage(error);
    const nextAttempt = job.attempts + 1;

    this.logger.error(
      `Job ${job.id} (${job.jobType}) failed on attempt ${nextAttempt}/${job.maxAttempts}: ${errorMessage}`,
      error instanceof Error ? error.stack : undefined,
    );

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
}

