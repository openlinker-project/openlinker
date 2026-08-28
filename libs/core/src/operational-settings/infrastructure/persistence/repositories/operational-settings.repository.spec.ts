/**
 * Operational Settings Repository Spec
 *
 * The one non-mechanical thing this repository does is the PARTIAL upsert: an
 * omitted field must be left alone while an explicit `null` clears it. Spreading
 * the input wholesale would write `undefined` into the SET list and clear a
 * value the caller never named, which is why that behaviour is pinned here.
 *
 * @module libs/core/src/operational-settings/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { OPERATIONAL_SETTINGS_SINGLETON_ID } from '../../../domain/entities/operational-settings.entity';
import type { OperationalSettingsOrmEntity } from '../entities/operational-settings.orm-entity';
import { OperationalSettingsRepository } from './operational-settings.repository';

describe('OperationalSettingsRepository', () => {
  let ormRepository: jest.Mocked<Repository<OperationalSettingsOrmEntity>>;
  let repository: OperationalSettingsRepository;

  const row = (): OperationalSettingsOrmEntity =>
    ({
      id: OPERATIONAL_SETTINGS_SINGLETON_ID,
      catalogueSweepBudget: 750,
      inventorySweepBudget: null,
      sweepPageSize: null,
      deletionAuditBudget: null,
      deletionAuditCadence: null,
      updatedAt: new Date('2026-08-27T09:00:00Z'),
      updatedBy: 'ada',
    }) as OperationalSettingsOrmEntity;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn().mockResolvedValue(row()),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Repository<OperationalSettingsOrmEntity>>;
    repository = new OperationalSettingsRepository(ormRepository);
  });

  it('should return null when no row has ever been written', async () => {
    await expect(repository.findSettings()).resolves.toBeNull();
  });

  it('should map the singleton row onto the domain entity', async () => {
    ormRepository.findOne.mockResolvedValue(row());

    const settings = await repository.findSettings();

    expect(settings?.catalogueSweepBudget).toBe(750);
    expect(settings?.inventorySweepBudget).toBeNull();
    expect(settings?.updatedBy).toBe('ada');
  });

  it('should write only the fields the input mentions', async () => {
    await repository.upsertSettings({ catalogueSweepBudget: 750 }, 'ada');

    const [payload] = ormRepository.upsert.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        id: OPERATIONAL_SETTINGS_SINGLETON_ID,
        catalogueSweepBudget: 750,
        updatedBy: 'ada',
      })
    );
    expect(payload).not.toHaveProperty('inventorySweepBudget');
    expect(payload).not.toHaveProperty('deletionAuditCadence');
  });

  it('should write an explicit null so a cleared field falls back to the env-or-default rung', async () => {
    await repository.upsertSettings({ sweepPageSize: null }, null);

    const [payload] = ormRepository.upsert.mock.calls[0];
    expect(payload).toEqual(expect.objectContaining({ sweepPageSize: null }));
  });

  it('should touch updatedAt explicitly — an upsert does not fire @UpdateDateColumn', async () => {
    await repository.upsertSettings({ catalogueSweepBudget: 1 }, null);

    const [payload] = ormRepository.upsert.mock.calls[0] as [
      { updatedAt?: unknown },
      unknown,
    ];
    expect(payload.updatedAt).toBeInstanceOf(Date);
  });
});
