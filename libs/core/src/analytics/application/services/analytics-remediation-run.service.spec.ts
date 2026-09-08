/**
 * Analytics Remediation Run Service Tests (#2468)
 *
 * @module libs/core/src/analytics/application/services
 */
import { AnalyticsRemediationRun } from '../../domain/entities/analytics-remediation-run.entity';
import type { AnalyticsRemediationRunRepositoryPort } from '../../domain/ports/analytics-remediation-run-repository.port';
import { AnalyticsRemediationRunService } from './analytics-remediation-run.service';

function run(overrides: Partial<AnalyticsRemediationRun> = {}): AnalyticsRemediationRun {
  return new AnalyticsRemediationRun(
    overrides.id ?? 'ol_remrun_abc',
    overrides.category ?? 'currency',
    overrides.status ?? 'in-progress',
    overrides.detail ?? null,
    overrides.affectedCount ?? 13,
    overrides.triggeredByUserId ?? 'user-1',
    overrides.createdAt ?? new Date('2026-08-26T09:00:00Z'),
    overrides.updatedAt ?? new Date('2026-08-26T09:00:00Z')
  );
}

describe('AnalyticsRemediationRunService', () => {
  let repository: jest.Mocked<AnalyticsRemediationRunRepositoryPort>;
  let service: AnalyticsRemediationRunService;

  beforeEach(() => {
    repository = {
      createRun: jest.fn(),
      findById: jest.fn(),
      findOpenByCategory: jest.fn(),
      transitionIfOpen: jest.fn(),
    };
    service = new AnalyticsRemediationRunService(repository);
  });

  describe('openRun', () => {
    it("should open the run directly at 'in-progress' — 'open' is a live detector value, never a stored one", async () => {
      repository.createRun.mockResolvedValue(run());

      const view = await service.openRun({
        category: 'currency',
        affectedCount: 13,
        triggeredByUserId: 'user-1',
      });

      expect(repository.createRun).toHaveBeenCalledWith(
        { category: 'currency', affectedCount: 13, triggeredByUserId: 'user-1' },
        'in-progress'
      );
      expect(view.status).toBe('in-progress');
    });
  });

  describe('markFailed', () => {
    it('should reject a blank detail — the mini-epic requires a failed run to always carry one', async () => {
      await expect(service.markFailed('ol_remrun_abc', '   ')).rejects.toThrow(
        /non-empty detail/
      );
      expect(repository.transitionIfOpen).not.toHaveBeenCalled();
    });

    it('should persist a trimmed detail alongside the failed status', async () => {
      repository.transitionIfOpen.mockResolvedValue(true);

      await service.markFailed('ol_remrun_abc', '  3 orders still unstamped  ');

      expect(repository.transitionIfOpen).toHaveBeenCalledWith(
        'ol_remrun_abc',
        'failed',
        '3 orders still unstamped'
      );
    });

    it('should report false rather than throwing when the run was already terminal', async () => {
      repository.transitionIfOpen.mockResolvedValue(false);

      await expect(service.markFailed('ol_remrun_abc', 'why')).resolves.toBe(false);
    });
  });

  describe('markResolved', () => {
    it('should clear the detail when resolving', async () => {
      repository.transitionIfOpen.mockResolvedValue(true);

      await service.markResolved('ol_remrun_abc');

      expect(repository.transitionIfOpen).toHaveBeenCalledWith('ol_remrun_abc', 'resolved', null);
    });
  });

  describe('cancelOpenRun (#2816)', () => {
    it('should terminalise the open run as failed with the given reason and report success', async () => {
      repository.findOpenByCategory.mockResolvedValue(run());
      repository.transitionIfOpen.mockResolvedValue(true);

      const result = await service.cancelOpenRun('currency', 'Cancelled by operator');

      expect(repository.findOpenByCategory).toHaveBeenCalledWith('currency');
      expect(repository.transitionIfOpen).toHaveBeenCalledWith(
        'ol_remrun_abc',
        'failed',
        'Cancelled by operator'
      );
      expect(result).toBe(true);
    });

    it('should return false without throwing when the category has no open run', async () => {
      repository.findOpenByCategory.mockResolvedValue(null);

      await expect(service.cancelOpenRun('currency', 'Cancelled by operator')).resolves.toBe(
        false
      );
      expect(repository.transitionIfOpen).not.toHaveBeenCalled();
    });

    it('should return false without throwing when the run resolved on its own between the read and the transition', async () => {
      repository.findOpenByCategory.mockResolvedValue(run());
      repository.transitionIfOpen.mockResolvedValue(false);

      await expect(service.cancelOpenRun('currency', 'Cancelled by operator')).resolves.toBe(
        false
      );
    });
  });

  describe('lifecycle read', () => {
    it('should return null for an unknown run id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getRun('nope')).resolves.toBeNull();
    });

    it('should surface a failed run with its detail so a poller can render it', async () => {
      repository.findById.mockResolvedValue(run({ status: 'failed', detail: '2 orders remain' }));

      await expect(service.getRun('ol_remrun_abc')).resolves.toMatchObject({
        status: 'failed',
        detail: '2 orders remain',
      });
    });
  });
});
