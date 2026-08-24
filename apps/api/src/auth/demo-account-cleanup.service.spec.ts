/**
 * DemoAccountCleanupService Unit Tests
 *
 * @module apps/api/src/auth
 */
import type { ConfigService } from '@nestjs/config';
import { DemoAccountCleanupService } from './demo-account-cleanup.service';
import type { IDemoModeService } from './demo-mode.service.interface';
import { User, type UserRepositoryPort } from '@openlinker/core/users';
import type { SyncLockPort } from '@openlinker/core/sync';

/**
 * Per-tick singleton lock across api replicas (#2279) — acquires by default;
 * `held: false` models a peer replica already running this tick.
 */
const makeSyncLock = (held = true): jest.Mocked<SyncLockPort> =>
  ({
    acquire: jest.fn().mockResolvedValue(held ? 'tok-1' : null),
    release: jest.fn().mockResolvedValue(true),
    extend: jest.fn().mockResolvedValue(true),
  }) as unknown as jest.Mocked<SyncLockPort>;

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
  updateAnalyticsConsent: jest.fn(),
  deleteAdminAtomically: jest.fn(),
  findStaleViewerAccounts: jest.fn(),
});

describe('DemoAccountCleanupService', () => {
  it('should do nothing when demo mode is off', async () => {
    const repo = makeRepo();
    const service = new DemoAccountCleanupService(
      repo,
      makeDemoService(false),
      makeConfig(),
      makeSyncLock(),
    );

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
      makeSyncLock(),
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
      makeSyncLock(),
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
      makeSyncLock(),
    );

    await service.cleanup();

    const statuses = repo.findStaleViewerAccounts.mock.calls[0][1];
    expect(statuses).toEqual(expect.arrayContaining(['active', 'pending_confirmation']));
  });

  it('should not delete anything when no accounts are stale', async () => {
    const repo = makeRepo();
    repo.findStaleViewerAccounts.mockResolvedValue([]);
    const service = new DemoAccountCleanupService(
      repo,
      makeDemoService(true),
      makeConfig(),
      makeSyncLock(),
    );

    await service.cleanup();

    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  describe('per-tick singleton lock across api replicas (#2279)', () => {
    it('skips the tick entirely when a peer replica holds the lock', async () => {
      const repo = makeRepo();
      const service = new DemoAccountCleanupService(
        repo,
        makeDemoService(true),
        makeConfig(),
        makeSyncLock(false),
      );

      await service.cleanup();

      expect(repo.findStaleViewerAccounts).not.toHaveBeenCalled();
    });

    it('releases the lock after a successful sweep', async () => {
      const repo = makeRepo();
      repo.findStaleViewerAccounts.mockResolvedValue([]);
      const syncLock = makeSyncLock();
      const service = new DemoAccountCleanupService(
        repo,
        makeDemoService(true),
        makeConfig(),
        syncLock,
      );

      await service.cleanup();

      expect(syncLock.release).toHaveBeenCalledWith('singleton:demo-cleanup', 'tok-1');
    });

    it('swallows a sweep failure and still releases the lock — the caller is a bare interval callback', async () => {
      const repo = makeRepo();
      repo.findStaleViewerAccounts.mockRejectedValue(new Error('db down'));
      const syncLock = makeSyncLock();
      const service = new DemoAccountCleanupService(
        repo,
        makeDemoService(true),
        makeConfig(),
        syncLock,
      );

      // Propagating here would be an unhandled rejection on the interval
      // callback and would take the API process down over a transient blip.
      await expect(service.cleanup()).resolves.toBeUndefined();
      expect(syncLock.release).toHaveBeenCalledWith('singleton:demo-cleanup', 'tok-1');
    });

    it('skips the tick rather than throwing when Redis is unavailable', async () => {
      const repo = makeRepo();
      const syncLock = makeSyncLock();
      syncLock.acquire.mockRejectedValue(new Error('redis down'));
      const service = new DemoAccountCleanupService(
        repo,
        makeDemoService(true),
        makeConfig(),
        syncLock,
      );

      await expect(service.cleanup()).resolves.toBeUndefined();
      expect(repo.findStaleViewerAccounts).not.toHaveBeenCalled();
    });

    it('does not take the lock at all when demo mode is off', async () => {
      const repo = makeRepo();
      const syncLock = makeSyncLock();
      const service = new DemoAccountCleanupService(
        repo,
        makeDemoService(false),
        makeConfig(),
        syncLock,
      );

      await service.cleanup();

      expect(syncLock.acquire).not.toHaveBeenCalled();
    });
  });
});
