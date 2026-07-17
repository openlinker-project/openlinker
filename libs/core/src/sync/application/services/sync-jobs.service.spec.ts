/**
 * Sync Jobs Service Unit Tests
 *
 * Pass-through assertions for `schedule` — verifies the service forwards
 * `(jobType, connectionId, payload, idempotencyKey, maxAttempts)` and
 * `{ runAfter }` to `SyncJobRepositoryPort.createIfNotExistsByIdempotencyKey`
 * unchanged.
 *
 * @module libs/core/src/sync/application/services
 */
import { SyncJobsService } from './sync-jobs.service';
import type { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { ScheduleJobInput } from './sync-jobs.types';

describe('SyncJobsService', () => {
  let repository: jest.Mocked<
    Pick<
      SyncJobRepositoryPort,
      'createIfNotExistsByIdempotencyKey' | 'requeueDeadByIdempotencyKey'
    >
  >;
  let service: SyncJobsService;

  beforeEach(() => {
    repository = {
      createIfNotExistsByIdempotencyKey: jest.fn(),
      requeueDeadByIdempotencyKey: jest.fn(),
    };
    service = new SyncJobsService(repository as unknown as SyncJobRepositoryPort);
  });

  describe('schedule', () => {
    it('forwards (input fields, runAfter) to createIfNotExistsByIdempotencyKey', async () => {
      const runAfter = new Date('2026-06-01T00:00:00.000Z');
      const input: ScheduleJobInput = {
        jobType: 'marketplace.offer.pollCreationStatus',
        connectionId: 'conn-1',
        payload: { foo: 'bar' },
        idempotencyKey: 'pollCreationStatus:rec-1:1',
        maxAttempts: 3,
        runAfter,
      };
      const persisted = { id: 'job-1' } as SyncJob;
      repository.createIfNotExistsByIdempotencyKey.mockResolvedValue(persisted);

      const result = await service.schedule(input);

      expect(result).toBe(persisted);
      expect(repository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(repository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledWith(
        {
          jobType: input.jobType,
          connectionId: input.connectionId,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          maxAttempts: input.maxAttempts,
        },
        { runAfter }
      );
    });

    it('forwards a different maxAttempts value verbatim', async () => {
      const runAfter = new Date('2026-06-01T00:00:00.000Z');
      repository.createIfNotExistsByIdempotencyKey.mockResolvedValue({ id: 'job-x' } as SyncJob);

      await service.schedule({
        jobType: 'marketplace.offer.pollCreationStatus',
        connectionId: 'conn-1',
        payload: {},
        idempotencyKey: 'key',
        maxAttempts: 7,
        runAfter,
      });

      const [arg0] = repository.createIfNotExistsByIdempotencyKey.mock.calls[0];
      expect(arg0.maxAttempts).toBe(7);
    });
  });

  describe('requeueDeadByIdempotencyKey (#1585 I3 / S3)', () => {
    it('delegates to the guarded repo update and returns true when a dead job was requeued', async () => {
      repository.requeueDeadByIdempotencyKey.mockResolvedValue(true);

      const result = await service.requeueDeadByIdempotencyKey('invoice:c:o');

      expect(result).toBe(true);
      expect(repository.requeueDeadByIdempotencyKey).toHaveBeenCalledWith('invoice:c:o');
    });

    it('returns false when the guarded update matched no dead job (absent / non-dead)', async () => {
      repository.requeueDeadByIdempotencyKey.mockResolvedValue(false);

      const result = await service.requeueDeadByIdempotencyKey('missing');

      expect(result).toBe(false);
      expect(repository.requeueDeadByIdempotencyKey).toHaveBeenCalledWith('missing');
    });
  });
});
