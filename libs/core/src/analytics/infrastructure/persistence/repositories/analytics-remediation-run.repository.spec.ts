/**
 * Analytics Remediation Run Repository Tests (#2468)
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import { QueryFailedError, type Repository } from 'typeorm';
import { OpenRemediationRunExistsError } from '../../../domain/exceptions/open-remediation-run-exists.error';
import type { AnalyticsRemediationRunOrmEntity } from '../entities/analytics-remediation-run.orm-entity';
import { AnalyticsRemediationRunRepository } from './analytics-remediation-run.repository';

function ormRow(
  overrides: Partial<AnalyticsRemediationRunOrmEntity> = {}
): AnalyticsRemediationRunOrmEntity {
  return {
    id: 'ol_remrun_abc',
    category: 'currency',
    status: 'in-progress',
    detail: null,
    affectedCount: 13,
    triggeredByUserId: 'user-1',
    createdAt: new Date('2026-08-26T09:00:00Z'),
    updatedAt: new Date('2026-08-26T09:00:00Z'),
    ...overrides,
  } as AnalyticsRemediationRunOrmEntity;
}

describe('AnalyticsRemediationRunRepository', () => {
  let ormRepository: jest.Mocked<Repository<AnalyticsRemediationRunOrmEntity>>;
  let updateBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };
  let repository: AnalyticsRemediationRunRepository;

  beforeEach(() => {
    updateBuilder = {
      update: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    updateBuilder.update.mockReturnValue(updateBuilder);
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.andWhere.mockReturnValue(updateBuilder);

    ormRepository = {
      create: jest.fn((input) => input as AnalyticsRemediationRunOrmEntity),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(updateBuilder),
    } as unknown as jest.Mocked<Repository<AnalyticsRemediationRunOrmEntity>>;
    repository = new AnalyticsRemediationRunRepository(ormRepository);
  });

  describe('createRun', () => {
    it('should mint an ol_remrun_-prefixed id when creating a run', async () => {
      ormRepository.save.mockImplementation((entity) => Promise.resolve(entity as never));

      const run = await repository.createRun(
        { category: 'currency', affectedCount: 13, triggeredByUserId: 'user-1' },
        'in-progress'
      );

      expect(run.id).toMatch(/^ol_remrun_[0-9a-f]{32}$/);
      expect(run.status).toBe('in-progress');
      expect(run.detail).toBeNull();
    });

    it('should translate a unique violation into the domain OpenRemediationRunExistsError, not leak QueryFailedError', async () => {
      // The partial unique index is the concurrency control — the service must
      // never see an infrastructure error type
      // (`docs/engineering-standards.md § Repository Error Handling`).
      ormRepository.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], new Error('duplicate key value violates unique constraint'))
      );

      await expect(
        repository.createRun(
          { category: 'currency', affectedCount: 3, triggeredByUserId: 'user-1' },
          'in-progress'
        )
      ).rejects.toBeInstanceOf(OpenRemediationRunExistsError);
    });

    it('should rethrow an unrelated database error unchanged', async () => {
      const boom = new Error('connection terminated');
      ormRepository.save.mockRejectedValue(boom);

      await expect(
        repository.createRun(
          { category: 'currency', affectedCount: 3, triggeredByUserId: 'user-1' },
          'in-progress'
        )
      ).rejects.toBe(boom);
    });
  });

  describe('transitionIfOpen', () => {
    it('should only update while the run is still open or in-progress', async () => {
      await repository.transitionIfOpen('ol_remrun_abc', 'resolved', null);

      expect(updateBuilder.andWhere).toHaveBeenCalledWith('status IN (:...openStatuses)', {
        openStatuses: ['open', 'in-progress'],
      });
    });

    it('should report false when another worker already terminalised the run', async () => {
      updateBuilder.execute.mockResolvedValue({ affected: 0 });

      await expect(repository.transitionIfOpen('ol_remrun_abc', 'resolved', null)).resolves.toBe(
        false
      );
    });
  });

  describe('toDomain', () => {
    it('should throw loudly on a lifecycle value this build cannot represent', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ status: 'half-done' }));

      await expect(repository.findById('ol_remrun_abc')).rejects.toThrow(
        /unknown value 'half-done'/
      );
    });

    it('should map a stored row onto the domain entity', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ status: 'failed', detail: 'why' }));

      const run = await repository.findById('ol_remrun_abc');

      expect(run).toEqual({
        id: 'ol_remrun_abc',
        category: 'currency',
        status: 'failed',
        detail: 'why',
        affectedCount: 13,
        triggeredByUserId: 'user-1',
        createdAt: new Date('2026-08-26T09:00:00Z'),
        updatedAt: new Date('2026-08-26T09:00:00Z'),
      });
    });
  });
});
