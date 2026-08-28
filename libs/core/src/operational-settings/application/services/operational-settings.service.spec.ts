/**
 * Operational Settings Service Spec
 *
 * Covers the resolution ladder end to end, the server-side bounds on the write
 * path, and the two guarantees #2651 calls load-bearing: an untouched install
 * behaves exactly as it did before, and the deletion audit cannot be disabled
 * through this surface.
 *
 * @module libs/core/src/operational-settings/application/services
 */
import type { ConfigService } from '@nestjs/config';
import { OperationalSettings } from '../../domain/entities/operational-settings.entity';
import { InvalidOperationalSettingError } from '../../domain/exceptions/operational-settings.exception';
import type { OperationalSettingsRepositoryPort } from '../../domain/ports/operational-settings-repository.port';
import { OperationalSettingsService } from './operational-settings.service';

const emptyRow = (): OperationalSettings =>
  new OperationalSettings(null, null, null, null, null, new Date('2026-08-01T00:00:00Z'), 'admin');

describe('OperationalSettingsService', () => {
  let repository: jest.Mocked<OperationalSettingsRepositoryPort>;
  let env: Record<string, string | undefined>;
  let service: OperationalSettingsService;

  beforeEach(() => {
    repository = {
      findSettings: jest.fn().mockResolvedValue(null),
      upsertSettings: jest.fn().mockResolvedValue(emptyRow()),
    };
    env = {};
    const configService = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    service = new OperationalSettingsService(repository, configService);
  });

  describe('resolve', () => {
    it('should reproduce the pre-#2651 constants when the table is empty and no env var is set', async () => {
      const view = await service.resolve();

      expect(view.catalogueSweepBudget).toEqual({ value: 500, source: 'default' });
      expect(view.inventorySweepBudget).toEqual({ value: 100, source: 'default' });
      expect(view.sweepPageSize).toEqual({ value: 100, source: 'default' });
      expect(view.deletionAuditBudget).toEqual({ value: 100, source: 'default' });
      expect(view.deletionAuditCadence).toEqual({ value: '0 * * * *', source: 'default' });
      expect(view.updatedAt).toBeNull();
      expect(view.updatedBy).toBeNull();
    });

    it('should honour the pre-existing env vars when no row has been written', async () => {
      env.OL_PRODUCT_SYNC_PAGE_LIMIT = '250';
      env.OL_MASTER_PRODUCT_RECONCILE_CRON = '*/30 * * * *';

      const view = await service.resolve();

      expect(view.catalogueSweepBudget).toEqual({ value: 250, source: 'env' });
      expect(view.deletionAuditCadence).toEqual({ value: '*/30 * * * *', source: 'env' });
    });

    it('should let a stored row win over the env var and report the row stamp', async () => {
      env.OL_PRODUCT_SYNC_PAGE_LIMIT = '250';
      repository.findSettings.mockResolvedValue(
        new OperationalSettings(900, null, null, null, null, new Date('2026-08-02T10:00:00Z'), 'ada')
      );

      const view = await service.resolve();

      expect(view.catalogueSweepBudget).toEqual({ value: 900, source: 'setting' });
      // The rest still fall through, per-field.
      expect(view.inventorySweepBudget.source).toBe('default');
      expect(view.updatedBy).toBe('ada');
    });

    it('should always report the deletion audit as enabled — this surface has no off switch', async () => {
      const view = await service.resolve();

      expect(view.deletionAuditAlwaysEnabled).toBe(true);
    });

    it('should fall back rather than hand the scheduler a stored cadence it cannot construct a CronJob from', async () => {
      repository.findSettings.mockResolvedValue(
        new OperationalSettings(null, null, null, null, 'not-a-cron', new Date(), null)
      );

      const view = await service.resolve();

      expect(view.deletionAuditCadence).toEqual({ value: '0 * * * *', source: 'default' });
    });

    it('should read the row on every call, so a change needs no restart', async () => {
      await service.resolve();
      await service.resolve();

      expect(repository.findSettings).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateSettings', () => {
    it('should persist a partial update, leaving omitted fields to the repository', async () => {
      await service.updateSettings({ catalogueSweepBudget: 750 }, 'ada');

      expect(repository.upsertSettings).toHaveBeenCalledWith({ catalogueSweepBudget: 750 }, 'ada');
    });

    it('should accept an explicit null as a clear back to the env-or-default rung', async () => {
      await service.updateSettings({ catalogueSweepBudget: null }, 'ada');

      expect(repository.upsertSettings).toHaveBeenCalledWith({ catalogueSweepBudget: null }, 'ada');
    });

    it('should reject an out-of-range value naming the field and the range', async () => {
      await expect(service.updateSettings({ catalogueSweepBudget: 5000 }, null)).rejects.toThrow(
        InvalidOperationalSettingError
      );
      await expect(service.updateSettings({ catalogueSweepBudget: 5000 }, null)).rejects.toThrow(
        'catalogueSweepBudget must be an integer between 1 and 2000'
      );
      expect(repository.upsertSettings).not.toHaveBeenCalled();
    });

    it('should reject a sweep page size above the batch-size clamp the handlers enforce', async () => {
      await expect(service.updateSettings({ sweepPageSize: 500 }, null)).rejects.toThrow(
        InvalidOperationalSettingError
      );
    });

    it('should accept a valid cron cadence', async () => {
      await service.updateSettings({ deletionAuditCadence: '*/15 * * * *' }, 'ada');

      expect(repository.upsertSettings).toHaveBeenCalled();
    });

    it('should reject a malformed cron expression', async () => {
      await expect(
        service.updateSettings({ deletionAuditCadence: 'every tuesday' }, null)
      ).rejects.toThrow(InvalidOperationalSettingError);
    });

    it('should reject an alias form rather than validate a second vocabulary', async () => {
      await expect(service.updateSettings({ deletionAuditCadence: '@hourly' }, null)).rejects.toThrow(
        'deletionAuditCadence must be a 5- or 6-field cron expression'
      );
    });

    it('should refuse a cadence that is a disable in disguise — the audit is the deletion authority', async () => {
      // Once a year. Valid cron, and #2222's deletion authority effectively off.
      await expect(
        service.updateSettings({ deletionAuditCadence: '0 0 1 1 *' }, null)
      ).rejects.toThrow('cannot be disabled through this surface');
      expect(repository.upsertSettings).not.toHaveBeenCalled();
    });

    it('should accept a weekly cadence, which is slow but is a schedule rather than a disable', async () => {
      await service.updateSettings({ deletionAuditCadence: '0 3 * * 1' }, 'ada');

      expect(repository.upsertSettings).toHaveBeenCalled();
    });
  });
});
