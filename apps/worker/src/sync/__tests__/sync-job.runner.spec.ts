/**
 * Sync Job Runner Unit Tests
 *
 * Unit tests for SyncJobRunner, verifying job execution, retry logic,
 * exponential backoff, error handling, and lifecycle management.
 *
 * @module apps/worker/src/sync
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test mock: explicit any narrows the dynamic spy / fixture shape */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyncJobRunner } from '../sync-job.runner';
import type { SyncJobRepositoryPort, RetryDeferral } from '@openlinker/core/sync';
import {
  SYNC_JOB_REPOSITORY_TOKEN,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  RetryClassifierRegistryService,
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
  AuthFailureClassifierRegistryService,
} from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../handlers/sync-job-handler.registry';
import { getCurrentPriority, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';
import type { SyncJobHandler } from '@openlinker/core/sync';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
// The runner's *production* code is now platform-neutral (#581 / #819) — it
// asks the classifier registries instead of `instanceof`-ing Allegro
// classes directly. The runner *spec* still uses the real Allegro
// classifiers wired into real registries to verify end-to-end behaviour;
// these imports don't follow the runner's deletions.
import {
  AllegroApiException,
  AllegroNetworkException,
  AllegroAuthenticationException,
  AllegroRetryClassifierAdapter,
  AllegroAuthFailureClassifierAdapter,
} from '@openlinker/integrations-allegro';
import { OfferCreationInvariantException } from '@openlinker/core/listings';
import { randomUUID } from 'crypto';

describe('SyncJobRunner', () => {
  let runner: SyncJobRunner;
  let jobRepository: jest.Mocked<SyncJobRepositoryPort>;
  let handlerRegistry: jest.Mocked<SyncJobHandlerRegistry>;
  let mockHandler: jest.Mocked<SyncJobHandler>;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    // Mock handler
    mockHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandler>;

    // Mock repository
    const mockRepository = {
      findAndLockDueJobs: jest.fn(),
      findAndLockDueJobsForLane: jest.fn().mockResolvedValue([]),
      markSucceeded: jest.fn(),
      markFailed: jest.fn(),
      markDead: jest.fn(),
      requeueStuckJobs: jest.fn(),
      heartbeat: jest.fn().mockResolvedValue(undefined),
      requeueWithoutPenalty: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SyncJobRepositoryPort>;

    // Mock handler registry — every lane resolves a small membership so the
    // lane-aware loop (#2278) issues claims in tests without the full
    // registration table.
    const mockRegistry = {
      getHandler: jest.fn(),
      register: jest.fn(),
      getRegisteredJobTypes: jest.fn(),
      getLane: jest.fn(),
      getJobTypesByLane: jest.fn().mockReturnValue(['master.product.syncByExternalId']),
      assertFullLaneCoverage: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandlerRegistry>;

    // Real registry + real Allegro classifier — the runner's behaviour
    // under each Allegro exception type is what these tests verify, and
    // we want the production registration path exercised end-to-end
    // rather than mocking the registry's `isNonRetryable` aggregation.
    //
    // FUTURE: when more platforms ship retry classifiers (Shopify,
    // WooCommerce, etc.), each one needs to be registered here and
    // covered by at least one behavioural assertion. Otherwise the
    // runner-spec invariant "all platforms classify retry the same way
    // they did before this PR" silently weakens. Track parallel work in
    // Thread E follow-ups.
    const retryClassifierRegistry = new RetryClassifierRegistryService();
    retryClassifierRegistry.register('allegro.publicapi.v1', new AllegroRetryClassifierAdapter());

    // Real auth-failure registry + real Allegro classifier — same rationale as
    // the retry registry above: exercise the production registration path so
    // the runner's "flag on terminal credential rejection" behaviour (#819) is
    // verified end-to-end rather than via a mocked `isCredentialRejected`.
    const authFailureClassifierRegistry = new AuthFailureClassifierRegistryService();
    authFailureClassifierRegistry.register(
      'allegro.publicapi.v1',
      new AllegroAuthFailureClassifierAdapter()
    );

    // Connection port mock — the runner flips a flagged connection's status.
    // Default: an active Allegro connection that updates cleanly.
    const mockConnectionPort = {
      get: jest.fn().mockResolvedValue({
        id: 'conn-1',
        platformType: 'allegro',
        status: 'active',
      }),
      update: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      create: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    moduleRef = await Test.createTestingModule({
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
        {
          provide: RETRY_CLASSIFIER_REGISTRY_TOKEN,
          useValue: retryClassifierRegistry,
        },
        {
          provide: AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
          useValue: authFailureClassifierRegistry,
        },
        {
          provide: CONNECTION_PORT_TOKEN,
          useValue: mockConnectionPort,
        },
      ],
    }).compile();

    runner = moduleRef.get<SyncJobRunner>(SyncJobRunner);
    jobRepository = moduleRef.get(SYNC_JOB_REPOSITORY_TOKEN);
    handlerRegistry = moduleRef.get(SyncJobHandlerRegistry);
    connectionPort = moduleRef.get(CONNECTION_PORT_TOKEN);
  });

  afterEach(async () => {
    // Stop runner if it was started
    if (runner) {
      try {
        await runner.onModuleDestroy();
      } catch {
        // Ignore errors during cleanup
      }
    }
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(async () => {
    // Close the testing module to trigger OnModuleDestroy on all providers
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('processJob', () => {
    const createMockJob = (_overrides?: Partial<SyncJob>): SyncJob => {
      return new SyncJob(
        randomUUID(),
        'master.product.syncByExternalId',
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
        new Date()
      );
    };

    it('should execute handler and mark job as succeeded on success', async () => {
      const job = createMockJob({ status: 'running' });
      mockHandler.execute.mockResolvedValueOnce({ outcome: 'ok' });
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(handlerRegistry.getHandler).toHaveBeenCalledWith(job.jobType);
      expect(mockHandler.execute).toHaveBeenCalledWith(job);
      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(job.id, 'ok', undefined);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('heartbeats periodically while the handler runs and stops once it settles (#1810)', async () => {
      jest.useFakeTimers();
      const job = createMockJob({ status: 'running' });
      let resolveHandler: (value: { outcome: 'ok' }) => void = () => {};
      const handlerPromise = new Promise<{ outcome: 'ok' }>((resolve) => {
        resolveHandler = resolve;
      });
      mockHandler.execute.mockReturnValueOnce(handlerPromise);
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      const processPromise = (runner as any).processJob(job);
      await Promise.resolve();

      // Simulate the handler still running past the 15-minute stuck-job
      // threshold (3 heartbeat ticks at the 3-minute interval = 9 min; a
      // 4th tick pushes past 12 min — well beyond a single reclaim sweep).
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime((runner as any).JOB_HEARTBEAT_INTERVAL_MS);
        await Promise.resolve();
      }
      expect(jobRepository.heartbeat).toHaveBeenCalledTimes(4);
      expect(jobRepository.heartbeat).toHaveBeenCalledWith(job.id, (runner as any).WORKER_ID);

      // Handler finally settles — the interval must be cleared so no
      // further heartbeats fire after the job is no longer running.
      resolveHandler({ outcome: 'ok' });
      await processPromise;
      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(job.id, 'ok', undefined);

      jobRepository.heartbeat.mockClear();
      jest.advanceTimersByTime((runner as any).JOB_HEARTBEAT_INTERVAL_MS * 2);
      await Promise.resolve();
      expect(jobRepository.heartbeat).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('swallows a heartbeat failure without interrupting the running handler (#1810)', async () => {
      jest.useFakeTimers();
      const job = createMockJob({ status: 'running' });
      let resolveHandler: (value: { outcome: 'ok' }) => void = () => {};
      const handlerPromise = new Promise<{ outcome: 'ok' }>((resolve) => {
        resolveHandler = resolve;
      });
      mockHandler.execute.mockReturnValueOnce(handlerPromise);
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);
      jobRepository.heartbeat.mockRejectedValueOnce(new Error('DB blip'));

      const processPromise = (runner as any).processJob(job);
      await Promise.resolve();

      jest.advanceTimersByTime((runner as any).JOB_HEARTBEAT_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();

      resolveHandler({ outcome: 'ok' });
      await processPromise;

      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(job.id, 'ok', undefined);
      jest.useRealTimers();
    });

    it("executes the handler under the 'background' rate-limit priority (#1810)", async () => {
      const job = createMockJob({ status: 'running' });
      let observedPriority: string | undefined;
      mockHandler.execute.mockImplementationOnce(() => {
        observedPriority = getCurrentPriority();
        return Promise.resolve({ outcome: 'ok' });
      });
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(observedPriority).toBe('background');
    });

    it('should persist outcome=business_failure when handler reports a terminal business rejection', async () => {
      const job = createMockJob({ status: 'running' });
      mockHandler.execute.mockResolvedValueOnce({ outcome: 'business_failure' });
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(
        job.id,
        'business_failure',
        undefined
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('should pass outcomeReason through to markSucceeded when the handler supplies one (#1689)', async () => {
      const job = createMockJob({ status: 'running' });
      mockHandler.execute.mockResolvedValueOnce({
        outcome: 'business_failure',
        outcomeReason: 'master_deleted',
      });
      handlerRegistry.getHandler.mockReturnValueOnce(mockHandler);
      jobRepository.markSucceeded.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(jobRepository.markSucceeded).toHaveBeenCalledWith(
        job.id,
        'business_failure',
        'master_deleted'
      );
    });

    it('should mark job as dead when no handler is registered', async () => {
      const job = createMockJob({ status: 'running' });
      handlerRegistry.getHandler.mockReturnValueOnce(null);
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).processJob(job);

      expect(handlerRegistry.getHandler).toHaveBeenCalledWith(job.jobType);
      expect(jobRepository.markDead).toHaveBeenCalledWith(
        job.id,
        `No handler registered for job type: ${job.jobType}`
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
        job.connectionId
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
        'master.product.syncByExternalId',
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
        new Date()
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

      expect(jobRepository.markFailed).toHaveBeenCalledWith(job.id, 'Test error', expect.any(Date));
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
        job.connectionId
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        'Product sync failed',
        expect.any(Date)
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
        expect.any(Date)
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
        expect.any(Date)
      );
    });

    it('should mark job as dead when OfferCreationInvariantException is thrown (issue #400)', async () => {
      const job = createMockJob(1, 10);
      const error = new OfferCreationInvariantException('rec_test_1', 'pending');
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, error.message);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should mark job as dead when AllegroApiException has deterministic 4xx (415)', async () => {
      const job = createMockJob(1, 10);
      const url = 'https://api.allegro.pl/sale/product-offers/1';
      const cause = new AllegroApiException('Unsupported content type', 415, 'body', url);
      const error = new SyncJobExecutionError(
        'Marketplace offer field update failed: Unsupported content type',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, error.message);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should keep retrying when AllegroApiException has 5xx (503)', async () => {
      const job = createMockJob(1, 10);
      const url = 'https://api.allegro.pl/sale/product-offers/1';
      const cause = new AllegroApiException('Service unavailable', 503, 'body', url);
      const error = new SyncJobExecutionError(
        'Allegro transient failure',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('should keep retrying when AllegroNetworkException is thrown (#499)', async () => {
      // #499: pre-fix, transient `TypeError: fetch failed` errors during
      // Allegro token refresh got reclassified as
      // `AllegroAuthenticationException` and killed the job on attempt 1/10.
      // The new `AllegroNetworkException` must NOT be on the non-retryable
      // list — runner should retry with backoff.
      const job = createMockJob(1, 10);
      const cause = new AllegroNetworkException(
        'Token refresh network failure: fetch failed',
        'https://allegro.pl/auth/oauth/token'
      );
      const error = new SyncJobExecutionError(
        'Marketplace orders poll failed: ' + cause.message,
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('should keep retrying when AllegroApiException has transient 4xx (408)', async () => {
      const job = createMockJob(1, 10);
      const url = 'https://api.allegro.pl/sale/product-offers/1';
      const cause = new AllegroApiException('Request timeout', 408, 'body', url);
      const error = new SyncJobExecutionError(
        'Allegro request timeout',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });
  });

  describe('rate-limit-timeout requeue (#1810 review follow-up)', () => {
    const createMockJob = (attempts: number, maxAttempts: number = 10): SyncJob => {
      return new SyncJob(
        randomUUID(),
        'master.product.syncByExternalId',
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
        new Date()
      );
    };

    it('requeues without penalty on a raw RateLimitTimeoutError — attempts untouched, markFailed/markDead never called', async () => {
      const job = createMockJob(9, 10); // would markDead under the ordinary path (next attempt = 10 >= max)
      const error = new RateLimitTimeoutError(120_000);

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();

      const nextRunAt = jobRepository.requeueWithoutPenalty.mock.calls[0][2];
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('unwraps SyncJobExecutionError.cause to find a wrapped RateLimitTimeoutError', async () => {
      const job = createMockJob(0, 10);
      const rateLimitError = new RateLimitTimeoutError(120_000);
      const wrapped = new SyncJobExecutionError(
        'Handler failed',
        job.id,
        job.jobType,
        job.connectionId,
        rateLimitError
      );

      await (runner as any).handleJobFailure(job, wrapped);

      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        job.id,
        wrapped.message,
        expect.any(Date)
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('does not treat an ordinary error as a rate-limit timeout', async () => {
      const job = createMockJob(2, 10);
      const error = new Error('some other transient failure');

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.requeueWithoutPenalty).not.toHaveBeenCalled();
      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
    });
  });

  describe('destination-declared retry deferral (#2613)', () => {
    const createMockJob = (attempts: number, maxAttempts: number = 10): SyncJob =>
      new SyncJob(
        randomUUID(),
        'master.product.syncByExternalId',
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
        new Date()
      );

    /** Stands in for any platform classifier that reports a deferral. */
    const registerDeferringClassifier = (deferral: RetryDeferral | null): void => {
      const registry = moduleRef.get<RetryClassifierRegistryService>(
        RETRY_CLASSIFIER_REGISTRY_TOKEN
      );
      registry.register('test.deferring.v1', {
        isNonRetryable: () => false,
        getRetryDeferral: () => deferral,
      });
    };

    it('requeues without penalty on a reported deferral, even on the last attempt', async () => {
      registerDeferringClassifier({ delaySeconds: 300, reason: 'shop unavailable (503)' });
      const job = createMockJob(9, 10); // would markDead under the ordinary path
      const error = new Error('PrestaShop API server error (503): /orders');

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        job.id,
        `shop unavailable (503): ${error.message}`,
        expect.any(Date)
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();

      const nextRunAt = jobRepository.requeueWithoutPenalty.mock.calls[0][2];
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now() + 290_000);
    });

    it('falls through to the ordinary backoff ladder when no classifier defers', async () => {
      registerDeferringClassifier(null);
      const job = createMockJob(2, 10);
      const error = new Error('some other transient failure');

      await (runner as any).handleJobFailure(job, error);

      expect(jobRepository.requeueWithoutPenalty).not.toHaveBeenCalled();
      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        job.id,
        error.message,
        expect.any(Date)
      );
    });
  });

  describe('connection flagging on terminal credential rejection (#819)', () => {
    const createMockJob = (): SyncJob =>
      new SyncJob(
        randomUUID(),
        'marketplace.orders.poll',
        'conn-1',
        { externalId: '1' },
        'running',
        `test-key-${randomUUID()}`,
        1,
        10,
        new Date(),
        new Date(),
        'worker-123',
        null,
        new Date(),
        new Date()
      );

    it('flags the connection needs_reauth when the cause is a terminal credential rejection', async () => {
      const job = createMockJob();
      const cause = new AllegroAuthenticationException(
        'Authentication failed: Invalid or expired access token',
        401,
        'https://api.allegro.pl/order/checkout-forms'
      );
      const error = new SyncJobExecutionError(
        'Marketplace orders poll failed: ' + cause.message,
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      connectionPort.get.mockResolvedValueOnce({
        id: job.connectionId,
        platformType: 'allegro',
        status: 'active',
      } as never);
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(connectionPort.update).toHaveBeenCalledWith(job.connectionId, {
        status: 'needs_reauth',
      });
      // The job is still marked dead — flagging is in addition to, not instead of.
      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, error.message);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('does NOT flag the connection on a transient network failure (still retryable)', async () => {
      const job = createMockJob();
      const cause = new AllegroNetworkException(
        'Token refresh network failure: fetch failed',
        'https://allegro.pl/auth/oauth/token'
      );
      const error = new SyncJobExecutionError(
        'Marketplace orders poll failed: ' + cause.message,
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markFailed.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(connectionPort.update).not.toHaveBeenCalled();
      expect(jobRepository.markFailed).toHaveBeenCalled();
      expect(jobRepository.markDead).not.toHaveBeenCalled();
    });

    it('does NOT flag the connection on a non-auth non-retryable error (deterministic 422)', async () => {
      const job = createMockJob();
      const cause = new AllegroApiException(
        'Validation failed',
        422,
        'body',
        'https://api.allegro.pl/x'
      );
      const error = new SyncJobExecutionError(
        'Marketplace offer create failed: Validation failed',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      // Marked dead (non-retryable) but NOT flagged — a 422 is a data problem,
      // not a credential rejection.
      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, error.message);
      expect(connectionPort.update).not.toHaveBeenCalled();
    });

    it('does NOT re-flag a connection that is not currently active', async () => {
      const job = createMockJob();
      const cause = new AllegroAuthenticationException('Invalid refresh token', 401);
      const error = new SyncJobExecutionError(
        'Marketplace orders poll failed',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      connectionPort.get.mockResolvedValueOnce({
        id: job.connectionId,
        platformType: 'allegro',
        status: 'disabled',
      } as never);
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (runner as any).handleJobFailure(job, error);

      expect(connectionPort.update).not.toHaveBeenCalled();
      expect(jobRepository.markDead).toHaveBeenCalled();
    });

    it('swallows connection-flagging errors without masking the job failure', async () => {
      const job = createMockJob();
      const cause = new AllegroAuthenticationException('Invalid refresh token', 401);
      const error = new SyncJobExecutionError(
        'Marketplace orders poll failed',
        job.id,
        job.jobType,
        job.connectionId,
        cause
      );
      connectionPort.get.mockRejectedValueOnce(new Error('DB down'));
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await expect((runner as any).handleJobFailure(job, error)).resolves.toBeUndefined();

      // Job is still marked dead despite the flagging failure.
      expect(jobRepository.markDead).toHaveBeenCalledWith(job.id, error.message);
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
        'master.product.syncByExternalId',
        randomUUID()
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
        'master.product.syncByExternalId',
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
        new Date()
      );

      jobRepository.findAndLockDueJobsForLane
        .mockResolvedValueOnce([job1])
        .mockResolvedValueOnce([]);

      mockHandler.execute.mockResolvedValueOnce({ outcome: 'ok' });
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

      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalled();
    }, 10000);

    it('should wait when no jobs are available', async () => {
      jobRepository.findAndLockDueJobsForLane.mockResolvedValue([]);

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

      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalled();
    }, 10000);

    it('should handle errors gracefully and continue polling', async () => {
      const error = new Error('Database error');
      jobRepository.findAndLockDueJobsForLane
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce([]);

      (runner as any).isRunning = true;
      const abortController = new AbortController();
      (runner as any).abortController = abortController;

      const runnerLoopPromise = (runner as any).runnerLoop();

      // Process pending promises to allow first call (which will error).
      // The lane-aware loop (#2278) adds an async hop (claimAndStartForLane)
      // between the loop body and the repository call, so the rejection needs
      // extra microtask turns to propagate into the catch and schedule the
      // backoff sleep before timers are advanced.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // The error should be caught and logged, then loop waits 1000ms before retry
      // Advance timers by 1000ms to allow the retry setTimeout to complete
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
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
      expect(jobRepository.findAndLockDueJobsForLane.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, 10000);

    it('should stop when abort signal is received', async () => {
      jobRepository.findAndLockDueJobsForLane.mockResolvedValue([]);

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

      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalled();
    }, 10000);
  });

  describe('lane scheduling (ADR-050, #2278)', () => {
    const createLaneJob = (connectionId: string): SyncJob =>
      new SyncJob(
        randomUUID(),
        'master.product.syncByExternalId',
        connectionId,
        { externalId: '1', objectType: 'Product' },
        'running',
        `test-key-${randomUUID()}`,
        0,
        10,
        new Date(),
        new Date(),
        'worker-test',
        null,
        new Date(),
        new Date()
      );

    const laneInFlight = (lane: string): Map<string, number> =>
      (runner as any).inFlightByLane.get(lane);

    const flushInFlight = async (): Promise<void> => {
      await Promise.race([
        Promise.allSettled([...(runner as any).inFlightJobs]),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
      // Let the finally-based slot release settle.
      await Promise.resolve();
      await Promise.resolve();
    };

    it('should not let a saturated bulk lane stop a realtime claim in the same tick', async () => {
      // Saturate bulk (total cap 2 by default).
      laneInFlight('bulk').set('conn-b', 2);

      const bulkStarted = await (runner as any).claimAndStartForLane('bulk');
      await (runner as any).claimAndStartForLane('realtime');

      expect(bulkStarted).toBe(0);
      // Bulk at cap issued NO claim; realtime still claimed independently, with
      // its own full headroom — that pair is the no-starvation property.
      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalledTimes(1);
      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 4 })
      );
    });

    it('should let every lane pull its own membership (no strict priority)', async () => {
      (handlerRegistry.getJobTypesByLane as jest.Mock).mockImplementation((lane: string) => [
        `${lane}-member`,
      ]);

      for (const lane of ['realtime', 'bulk', 'fiscal', 'fan-out']) {
        await (runner as any).claimAndStartForLane(lane);
      }

      const claimedTypeSets = (jobRepository.findAndLockDueJobsForLane as jest.Mock).mock.calls.map(
        ([input]: [{ jobTypes: string[] }]) => input.jobTypes[0]
      );
      expect(claimedTypeSets).toEqual([
        'realtime-member',
        'bulk-member',
        'fiscal-member',
        'fan-out-member',
      ]);
    });

    it('should pass scopes at their per-scope cap as claim exclusions', async () => {
      // realtime per-scope cap is 2 by default.
      laneInFlight('realtime').set('conn-at-cap', 2);
      laneInFlight('realtime').set('conn-under-cap', 1);

      await (runner as any).claimAndStartForLane('realtime');

      expect(jobRepository.findAndLockDueJobsForLane).toHaveBeenCalledWith(
        expect.objectContaining({ excludedScopes: ['conn-at-cap'] })
      );
    });

    it('should release intra-batch surplus beyond the per-scope cap without penalty', async () => {
      // bulk per-scope cap is 1 by default; one claim returns two same-scope jobs.
      const jobA = createLaneJob('conn-wave');
      const jobB = createLaneJob('conn-wave');
      jobRepository.findAndLockDueJobsForLane.mockResolvedValueOnce([jobA, jobB]);
      mockHandler.execute.mockResolvedValue({ outcome: 'ok' });
      handlerRegistry.getHandler.mockReturnValue(mockHandler);
      jobRepository.markSucceeded.mockResolvedValue(undefined);

      const started = await (runner as any).claimAndStartForLane('bulk');

      expect(started).toBe(1);
      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        jobB.id,
        expect.stringContaining('per-scope cap'),
        expect.any(Date)
      );
      await flushInFlight();
    });

    it('should release the slot when a rate-limited job requeues, in its own lane', async () => {
      const job = createLaneJob('conn-rl');
      jobRepository.findAndLockDueJobsForLane.mockResolvedValueOnce([job]);
      handlerRegistry.getHandler.mockReturnValue(mockHandler);
      mockHandler.execute.mockRejectedValueOnce(new RateLimitTimeoutError(120_000));

      const started = await (runner as any).claimAndStartForLane('realtime');
      expect(started).toBe(1);
      expect(laneInFlight('realtime').get('conn-rl')).toBe(1);

      await flushInFlight();

      // Penalty-free requeue happened and the lane slot was released.
      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        job.id,
        expect.any(String),
        expect.any(Date)
      );
      expect(laneInFlight('realtime').has('conn-rl')).toBe(false);
    });

    it('should sleep rather than spin when every lane is at cap with jobs in flight', async () => {
      laneInFlight('realtime').set('a', 4);
      laneInFlight('bulk').set('a', 2);
      laneInFlight('fiscal').set('a', 2);
      laneInFlight('fan-out').set('a', 1);

      const sleepSpy = jest.spyOn(runner as any, 'sleep').mockImplementation(() => {
        (runner as any).isRunning = false; // exit after the first sleep
        return Promise.resolve();
      });

      (runner as any).isRunning = true;
      (runner as any).abortController = new AbortController();
      await (runner as any).runnerLoop();

      expect(jobRepository.findAndLockDueJobsForLane).not.toHaveBeenCalled();
      expect(sleepSpy).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should start the runner loop', () => {
      // Override ConfigService to enable runner for this test
      const configService = moduleRef.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_RUNNER_ENABLED') {
          return 'true'; // Enable runner for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(runner as any, 'startRunner');

      runner.onModuleInit();

      expect((runner as any).startRunner).toHaveBeenCalled();
    });

    it('should not start runner when WORKER_RUNNER_ENABLED=false', () => {
      // Override ConfigService to disable runner for this test
      const configService = moduleRef.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_RUNNER_ENABLED') {
          return 'false'; // Disable runner for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(runner as any, 'startRunner');

      runner.onModuleInit();

      expect((runner as any).startRunner).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop runner and cleanup', async () => {
      jest.useFakeTimers();
      jest.spyOn(runner as any, 'stopRunner');

      await runner.onModuleDestroy();

      expect((runner as any).stopRunner).toHaveBeenCalled();

      jest.clearAllTimers();
      jest.useRealTimers();
    });
  });
});
