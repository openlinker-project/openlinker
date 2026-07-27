/**
 * DemoAccountCleanupService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import { DemoAccountCleanupService } from './demo-account-cleanup.service';
import type { IDemoModeService } from './demo-mode.service.interface';
import { User, type UserRepositoryPort } from '@openlinker/core/users';

const makeUser = (id: string): User =>
  new User(id, `user-${id}`, `${id}@test.com`, 'hash', 'viewer', 'active', new Date(), new Date());

const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
  }) as unknown as ConfigService;

const makeDemoService = (enabled: boolean): IDemoModeService => ({
  isDemoModeEnabled: () => enabled,
});

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  save: jest.fn(),
  updatePasswordHash: jest.fn(),
  updateStatus: jest.fn(),
  updateRole: jest.fn(),
  approveUser: jest.fn(),
  deleteById: jest.fn(),
  deactivateAdminAtomically: jest.fn(),
  updateAdminRoleAtomically: jest.fn(),
  deleteAdminAtomically: jest.fn(),
  findStaleViewerAccounts: jest.fn(),
});

describe('DemoAccountCleanupService', () => {
  it('should do nothing when demo mode is off', async () => {
    const repo = makeRepo();
    const service = new DemoAccountCleanupService(repo, makeDemoService(false), makeConfig());

    await service.cleanup();

    expect(repo.findStaleViewerAccounts).not.toHaveBeenCalled();
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('should delete every stale viewer account when demo mode is on', async () => {
    const repo = makeRepo();
    repo.findStaleViewerAccounts.mockResolvedValue([makeUser('u1'), makeUser('u2')]);
    const service = new DemoAccountCleanupService(
      repo,
      makeDemoService(true),
      makeConfig({ OL_DEMO_ACCOUNT_RETENTION_HOURS: '24' }),
    );

    await service.cleanup();

    expect(repo.deleteById).toHaveBeenCalledTimes(2);
    expect(repo.deleteById).toHaveBeenCalledWith('u1');
    expect(repo.deleteById).toHaveBeenCalledWith('u2');
  });

  it('should query with a cutoff derived from the configured retention window', async () => {
    const repo = makeRepo();
    repo.findStaleViewerAccounts.mockResolvedValue([]);
    const now = new Date('2026-01-02T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const service = new DemoAccountCleanupService(
      repo,
      makeDemoService(true),
      makeConfig({ OL_DEMO_ACCOUNT_RETENTION_HOURS: '24' }),
    );

    await service.cleanup();

    const cutoff = repo.findStaleViewerAccounts.mock.calls[0][0];
    expect(cutoff.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    jest.useRealTimers();
  });

  it('should sweep both active and pending_confirmation statuses', async () => {
    const repo = makeRepo();
    repo.findStaleViewerAccounts.mockResolvedValue([]);
    const service = new DemoAccountCleanupService(
      repo,
      makeDemoService(true),
      makeConfig({ OL_DEMO_ACCOUNT_RETENTION_HOURS: '24' }),
    );

    await service.cleanup();

    const statuses = repo.findStaleViewerAccounts.mock.calls[0][1];
    expect(statuses).toEqual(expect.arrayContaining(['active', 'pending_confirmation']));
  });

  it('should not delete anything when no accounts are stale', async () => {
    const repo = makeRepo();
    repo.findStaleViewerAccounts.mockResolvedValue([]);
    const service = new DemoAccountCleanupService(repo, makeDemoService(true), makeConfig());

    await service.cleanup();

    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});
