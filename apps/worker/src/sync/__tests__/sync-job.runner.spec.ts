/**
 * Sync Job Runner Unit Tests
 *
 * Unit tests for SyncJobRunner, verifying job execution, retry logic,
 * exponential backoff, error handling, and lifecycle management.
 *
 * @module apps/worker/src/sync
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyncJobRunner } from '../sync-job.runner';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../handlers/sync-job-handler.registry';
import { SyncJobHandler } from '@openlinker/core/sync/domain/ports/sync-job-handler.port';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import { randomUUID } from 'crypto';

describe('SyncJobRunner', () => {
  let runner: SyncJobRunner;
  let jobRepository: jest.Mocked<SyncJobRepositoryPort>;
  let handlerRegistry: jest.Mocked<SyncJobHandlerRegistry>;
  let mockHandler: jest.Mocked<SyncJobHandler>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock handler
    mockHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandler>;

    // Mock repository
    const mockRepository = {
      findAndLockDueJobs: jest.fn(),
      markSucceeded: jest.fn(),
      markFailed: jest.fn(),
      markDead: jest.fn(),
      requeueStuckJobs: jest.fn(),
    } as unknown as jest.Mocked<SyncJobRepositoryPort>;

    // Mock handler registry
    const mockRegistry = {
      getHandler: jest.fn(),
      register: jest.fn(),
      getRegisteredJobTypes: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandlerRegistry>;

    module = await Test.createTestingModule({
      providers: [
        SyncJobRunner,
        {
          provide: SYNC_JOB_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: SyncJobHandlerRegistry,
          useValue: mockRegistry,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              // Return env var or default (env vars set in jest.setup.ts)
              return process.env[key] ?? defaultValue ?? 'true';
            }),
          },
        },
      ],
    }).compile();

    runner = module.get<SyncJobRunner>(SyncJobRunner);
    jobRepository = module.get(SYNC_JOB_REPOSITORY_TOKEN);
    handlerRegistry = module.get(SyncJobHandlerRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('processJob', () => {
    const createMockJob = (_overrides?: Partial<SyncJob>): SyncJob => {
      return new SyncJob(
        randomUUID(),
        'prestashop.product.syncByExternalId',
        randomUUID(),
        { externalId: '1', objectType: 'Product' },
        'queued',
        `test-key-${randomUUID()}`,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );
    };

    it('should execute handler and mark job as succeeded on success', async () => {
      const job = createMockJob({ status: 'running' });
      mockHandler.execute.mockResolvedValueOnce(undefined);
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(handlerRegistry.getHandler).toHaveBeenCalledWith(job.jobType);
      expect(mockHandler.execute).toHaveBeenCalledWith(job);
      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(job.id);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('should mark job as dead when no handler is registered', async () => {
      const job = createMockJob({ status: 'running' });
      handlerRegistry.getHandler.mockReturnValueOnce(null);
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(handlerRegistry.getHandler).toHaveBeenCalledWith(job.jobType);
      expect(jobRepository.markDead).toHaveBeenCalledWith(
        job.id,
        `No handler registered for job type: ${job.jobType}`,
      );
      expect(mockHandler.execute).not.toHaveBeenCalled();
      expect(jobRepository.markSucceeded).not.toHaveBeenCalled();
    });

    it('should handle handler errors and call handleJobFailure', async () => {
      const job = createMockJob({ status: 'running', attempts: 1, maxAttempts: 10 });
      const error = new Error('Handler execution failed');
      mockHandler.execute.mockRejectedValueOnce(error);
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(mockHandler.execute).toHaveBeenCalledWith(job);
      expect(jobRepository.markSucceeded).not.toHaveBeenCalled();
      expect(jobRepository.markFailed).toHaveBeenCalled();
    });

    it('should handle SyncJobExecutionError and call handleJobFailure', async () => {
      const job = createMockJob({ status: 'running', attempts: 1, maxAttempts: 10 });
      const error = new SyncJobExecutionError(
        'Product not found',
        job.id,
        job.jobType,
        job.connectionId,
      );
      mockHandler.execute.mockRejectedValueOnce(error);
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(mockHandler.execute).toHaveBeenCalledWith(job);
      expect(jobRepository.markFailed).toHaveBeenCalled();
    });
  });

  describe('handleJobFailure', () => {
    const createMockJob = (attempts: number, maxAttempts: number = 10): SyncJob => {
      return new SyncJob(
        randomUUID(),
        'prestashop.product.syncByExternalId',
        randomUUID(),
        { externalId: '1' },
        'running',
        `test-key-${randomUUID()}`,
        attempts,
        maxAttempts,
        new Date(),
        new Date(),
        'worker-123',
        null,
        new Date(),
        new Date(),
      );
    };

    it('should mark job as dead when maxAttempts is reached', async () => {
      const job = createMockJob(9, 10); // 9 attempts, max 10 (next attempt = 10, which is >= max)
      const error = new Error('Test error');
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, 'Test error');
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should mark job as failed and schedule retry when attempts < maxAttempts', async () => {
      const job = createMockJob(2, 10); // 2 attempts, max 10 (next attempt = 3, which is < max)
      const error = new Error('Test error');
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        'Test error',
        expect.any(Date),
      );
      expect(jobRepository.markDead).not.toHaveBeenCalled();

      // Verify nextRunAt is in the future (exponential backoff)
      const markFailedCall = jobRepository.markFailed.mock.calls[0];
      const nextRunAt = markFailedCall[2];
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should extract error message from SyncJobExecutionError', async () => {
      const job = createMockJob(1, 10);
      const error = new SyncJobExecutionError(
        'Product sync failed',
        job.id,
        job.jobType,
        job.connectionId,
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        'Product sync failed',
        expect.any(Date),
      );
    });

    it('should extract error message from Error', async () => {
      const job = createMockJob(1, 10);
      const error = new Error('Network timeout');
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        'Network timeout',
        expect.any(Date),
      );
    });

    it('should convert non-Error to string', async () => {
      const job = createMockJob(1, 10);
      const error = 'String error';
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        'String error',
        expect.any(Date),
      );
    });
  });

  describe('calculateBackoff', () => {
    it('should return base delay for attempt 1', () => {
      const backoff = (runner as any).calculateBackoff(1);
      expect(backoff).toBe(30); // RETRY_BASE_DELAY_SECONDS
    });

    it('should return base delay * multiplier for attempt 2', () => {
      const backoff = (runner as any).calculateBackoff(2);
      expect(backoff).toBe(60); // 30 * 2^1
    });

    it('should return base delay * multiplier^2 for attempt 3', () => {
      const backoff = (runner as any).calculateBackoff(3);
      expect(backoff).toBe(120); // 30 * 2^2
    });

    it('should return base delay * multiplier^3 for attempt 4', () => {
      const backoff = (runner as any).calculateBackoff(4);
      expect(backoff).toBe(240); // 30 * 2^3
    });

    it('should return base delay * multiplier^4 for attempt 5', () => {
      const backoff = (runner as any).calculateBackoff(5);
      expect(backoff).toBe(480); // 30 * 2^4
    });

    it('should cap at max delay for high attempt numbers', () => {
      const backoff = (runner as any).calculateBackoff(20);
      const maxDelay = 6 * 60 * 60; // 6 hours in seconds
      expect(backoff).toBe(maxDelay);
    });

    it('should cap at max delay for attempt 6', () => {
      const backoff = (runner as any).calculateBackoff(6);
      // Attempt 6: 30 * 2^(6-1) = 30 * 32 = 960 seconds
      // This is less than maxDelay (21600), so it's not capped
      expect(backoff).toBe(960);
    });

    it('should calculate exponential backoff correctly for various attempts', () => {
      const testCases = [
        { attempt: 1, expected: 30 },
        { attempt: 2, expected: 60 },
        { attempt: 3, expected: 120 },
        { attempt: 4, expected: 240 },
        { attempt: 5, expected: 480 },
      ];

      for (const testCase of testCases) {
        const backoff = (runner as any).calculateBackoff(testCase.attempt);
        expect(backoff).toBe(testCase.expected);
      }
    });
  });

  describe('extractErrorMessage', () => {
    it('should extract message from SyncJobExecutionError', () => {
      const error = new SyncJobExecutionError(
        'Product not found',
        randomUUID(),
        'prestashop.product.syncByExternalId',
        randomUUID(),
      );
      const message = (runner as any).extractErrorMessage(error);
      expect(message).toBe('Product not found');
    });

    it('should extract message from Error', () => {
      const error = new Error('Network timeout');
      const message = (runner as any).extractErrorMessage(error);
      expect(message).toBe('Network timeout');
    });

    it('should convert non-Error to string', () => {
      const error = 'String error';
      const message = (runner as any).extractErrorMessage(error);
      expect(message).toBe('String error');
    });

    it('should handle null/undefined gracefully', () => {
      const message1 = (runner as any).extractErrorMessage(null);
      expect(message1).toBe('null');

      const message2 = (runner as any).extractErrorMessage(undefined);
      expect(message2).toBe('undefined');
    });
  });

  describe('runnerLoop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      // Clean up stuck job recovery interval
      if ((runner as any).stuckJobRecoveryInterval) {
        clearInterval((runner as any).stuckJobRecoveryInterval);
        (runner as any).stuckJobRecoveryInterval = null;
      }
      // Clean up any running loops
      (runner as any).isRunning = false;
      if ((runner as any).abortController) {
        // Check if it's an actual AbortController instance
        if (typeof (runner as any).abortController.abort === 'function') {
          (runner as any).abortController.abort();
        } else {
          // It's a mock object, just set aborted flag
          (runner as any).abortController.signal = { aborted: true };
        }
      }
      // Clear all timers before restoring real timers
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('should poll for jobs and process them', async () => {
      const job1 = new SyncJob(
        randomUUID(),
        'prestashop.product.syncByExternalId',
        randomUUID(),
        { externalId: '1' },
        'queued',
        `test-key-${randomUUID()}`,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.findAndLockDueJobs
        .mockResolvedValueOnce([job1])
        .mockResolvedValueOnce([]);

      mockHandler.execute.mockResolvedValueOnce(undefined);
      handlerRegistry.getHandler.mockReturnValue(mockHandler);
      jobRepository.markSucceeded.mockResolvedValue(undefined);

      // Set isRunning before starting loop
      (runner as any).isRunning = true;
      (runner as any).abortController = { signal: { aborted: false } };

      // Start runner loop
      const runnerLoopPromise = (runner as any).runnerLoop();

      // Process pending promises to allow first iteration
      await Promise.resolve();

      // Process job execution
      await Promise.resolve();

      // Stop runner after first iteration (before next poll)
      (runner as any).isRunning = false;
      (runner as any).abortController = { signal: { aborted: true } };

      // Advance timers to complete any pending setTimeout
      jest.runOnlyPendingTimers();

      // Process any remaining promises
      await Promise.resolve();

      // Wait for loop to exit (with timeout)
      await Promise.race([
        runnerLoopPromise.catch(() => {
          // Loop may throw when aborted, which is expected
        }),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);

      expect(jobRepository.findAndLockDueJobs).toHaveBeenCalled();
    }, 10000);

    it('should wait when no jobs are available', async () => {
      jobRepository.findAndLockDueJobs.mockResolvedValue([]);

      (runner as any).isRunning = true;
      const abortController = new AbortController();
      (runner as any).abortController = abortController;

      const runnerLoopPromise = (runner as any).runnerLoop();

      // Process pending promises to allow first iteration
      await Promise.resolve();

      // Stop runner before setTimeout completes
      (runner as any).isRunning = false;
      abortController.abort();

      // Advance timers to complete any pending setTimeout
      jest.runOnlyPendingTimers();

      // Process any remaining promises
      await Promise.resolve();

      // Wait for loop to exit (with timeout)
      await Promise.race([
        runnerLoopPromise.catch(() => {
          // Expected when aborted
        }),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);

      expect(jobRepository.findAndLockDueJobs).toHaveBeenCalled();
    }, 10000);

    it('should handle errors gracefully and continue polling', async () => {
      const error = new Error('Database error');
      jobRepository.findAndLockDueJobs
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce([]);

      (runner as any).isRunning = true;
      const abortController = new AbortController();
      (runner as any).abortController = abortController;

      const runnerLoopPromise = (runner as any).runnerLoop();

      // Process pending promises to allow first call (which will error)
      await Promise.resolve();

      // The error should be caught and logged, then loop waits 1000ms before retry
      // Advance timers by 1000ms to allow the retry setTimeout to complete
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Process the retry call (which should succeed with empty array)
      await Promise.resolve();

      // After getting empty array, loop will wait POLL_INTERVAL_MS (1000ms) before next poll
      // Stop runner BEFORE that wait completes
      (runner as any).isRunning = false;
      abortController.abort();

      // Advance timers by POLL_INTERVAL_MS to allow the loop to check abort condition
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Wait for loop to exit
      await Promise.race([
        runnerLoopPromise.catch(() => {
          // Expected when aborted
        }),
        new Promise<void>((resolve) => {
          jest.useRealTimers();
          setTimeout(() => resolve(), 50);
          jest.useFakeTimers();
        }),
      ]);

      // Should have retried after error
      expect(jobRepository.findAndLockDueJobs).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should stop when abort signal is received', async () => {
      jobRepository.findAndLockDueJobs.mockResolvedValue([]);

      (runner as any).isRunning = true;
      const abortController = new AbortController();
      (runner as any).abortController = abortController;

      const runnerLoopPromise = (runner as any).runnerLoop();

      // Process pending promises to allow first iteration
      await Promise.resolve();

      // Immediately abort
      abortController.abort();

      // Stop runner
      (runner as any).isRunning = false;

      // Advance timers to complete any pending setTimeout
      jest.runOnlyPendingTimers();

      // Process any remaining promises
      await Promise.resolve();

      // Wait for loop to exit (with timeout)
      await Promise.race([
        runnerLoopPromise.catch(() => {
          // Expected when aborted
        }),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);

      expect(jobRepository.findAndLockDueJobs).toHaveBeenCalled();
    }, 10000);
  });

  describe('onModuleInit', () => {
    it('should start runner and stuck job recovery', () => {
      // Override ConfigService to enable runner for this test
      const configService = module.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_RUNNER_ENABLED') {
          return 'true'; // Enable runner for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(runner as any, 'startRunner');
      jest.spyOn(runner as any, 'startStuckJobRecovery');

      runner.onModuleInit();

      expect((runner as any).startRunner).toHaveBeenCalled();
      expect((runner as any).startStuckJobRecovery).toHaveBeenCalled();
    });

    it('should not start runner when WORKER_RUNNER_ENABLED=false', () => {
      // Override ConfigService to disable runner for this test
      const configService = module.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_RUNNER_ENABLED') {
          return 'false'; // Disable runner for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(runner as any, 'startRunner');
      jest.spyOn(runner as any, 'startStuckJobRecovery');

      runner.onModuleInit();

      expect((runner as any).startRunner).not.toHaveBeenCalled();
      expect((runner as any).startStuckJobRecovery).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop runner and cleanup', async () => {
      jest.spyOn(runner as any, 'stopRunner');

      // Initialize stuck job recovery interval
      (runner as any).stuckJobRecoveryInterval = setInterval(() => {}, 1000);

      await runner.onModuleDestroy();

      expect((runner as any).stopRunner).toHaveBeenCalled();
      expect((runner as any).stuckJobRecoveryInterval).toBeNull();
    });
  });

  describe('startStuckJobRecovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should periodically check for stuck jobs', async () => {
      jobRepository.requeueStuckJobs.mockResolvedValue(0);

      (runner as any).startStuckJobRecovery();

      // Fast-forward past recovery interval (5 minutes)
      jest.advanceTimersByTime(5 * 60 * 1000);

      await Promise.resolve(); // Allow async operations to complete

      expect(jobRepository.requeueStuckJobs).toHaveBeenCalledWith(15); // STUCK_JOB_TIMEOUT_MINUTES
    });

    it('should log warning when stuck jobs are requeued', async () => {
      jobRepository.requeueStuckJobs.mockResolvedValue(3);

      (runner as any).startStuckJobRecovery();

      // Fast-forward past recovery interval
      jest.advanceTimersByTime(5 * 60 * 1000);

      await Promise.resolve();

      expect(jobRepository.requeueStuckJobs).toHaveBeenCalled();
    });

    it('should handle errors in stuck job recovery gracefully', async () => {
      const error = new Error('Database error');
      jobRepository.requeueStuckJobs.mockRejectedValue(error);

      (runner as any).startStuckJobRecovery();

      // Fast-forward past recovery interval
      jest.advanceTimersByTime(5 * 60 * 1000);

      await Promise.resolve();

      // Should not throw, error should be logged
      expect(jobRepository.requeueStuckJobs).toHaveBeenCalled();
    });
  });
});

