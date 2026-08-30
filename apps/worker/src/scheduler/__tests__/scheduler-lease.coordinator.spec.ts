/**
 * Scheduler Lease Coordinator Unit Tests
 *
 * Pins the fleet-singleton wiring (#2279, ADR-051): the coordinator competes
 * only when enabled, drives `SchedulerService.start()/stop()` off lease
 * transitions, releases on shutdown, and resolves the TTL defensively
 * (clamped range, non-numeric ignored) — a zero or absurd TTL would either
 * stall the scheduler or park it for hours.
 *
 * @module apps/worker/src/scheduler
 */
import type { ConfigService } from '@nestjs/config';
import type { SyncLockPort } from '@openlinker/core/sync';
import { SchedulerLeaseCoordinator } from '../scheduler-lease.coordinator';
import type { SchedulerService } from '../scheduler.service';

describe('SchedulerLeaseCoordinator', () => {
  let schedulerService: jest.Mocked<
    Pick<SchedulerService, 'start' | 'stop' | 'refreshOperationalSettings'>
  >;
  let syncLock: jest.Mocked<SyncLockPort>;

  const makeConfig = (overrides: Record<string, string | undefined> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) =>
        key in overrides ? overrides[key] : defaultValue
      ),
    }) as unknown as ConfigService;

  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  const build = (overrides: Record<string, string | undefined> = {}): SchedulerLeaseCoordinator =>
    new SchedulerLeaseCoordinator(
      schedulerService as unknown as SchedulerService,
      makeConfig(overrides),
      syncLock
    );

  beforeEach(() => {
    schedulerService = {
      start: jest.fn(),
      stop: jest.fn(),
      // Awaited before start() so the operator-settable cadences are in hand
      // when the cron jobs are constructed (#2651).
      refreshOperationalSettings: jest.fn().mockResolvedValue(undefined),
    };
    syncLock = {
      acquire: jest.fn().mockResolvedValue('tok-1'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SyncLockPort>;
  });

  it('starts the scheduler on the process that wins the lease', async () => {
    const coordinator = build();

    coordinator.onApplicationBootstrap();
    await settle();

    expect(syncLock.acquire).toHaveBeenCalledWith('singleton:scheduler', 60_000);
    expect(schedulerService.start).toHaveBeenCalledTimes(1);

    await coordinator.onModuleDestroy();
  });

  it('leaves the scheduler stopped on a replica that loses the race', async () => {
    syncLock.acquire.mockResolvedValue(null);
    const coordinator = build();

    coordinator.onApplicationBootstrap();
    await settle();

    expect(schedulerService.start).not.toHaveBeenCalled();

    await coordinator.onModuleDestroy();
  });

  it('does not compete at all when OL_SCHEDULER_ENABLED=false', async () => {
    const coordinator = build({ OL_SCHEDULER_ENABLED: 'false' });

    coordinator.onApplicationBootstrap();
    await settle();

    expect(syncLock.acquire).not.toHaveBeenCalled();
    expect(schedulerService.start).not.toHaveBeenCalled();

    await coordinator.onModuleDestroy();
  });

  it('stops the scheduler and releases the lease on shutdown, so failover is immediate', async () => {
    const coordinator = build();
    coordinator.onApplicationBootstrap();
    await settle();

    await coordinator.onModuleDestroy();

    expect(syncLock.release).toHaveBeenCalledWith('singleton:scheduler', 'tok-1');
    expect(schedulerService.stop).toHaveBeenCalled();
  });

  it('tolerates a shutdown that never booted', async () => {
    const coordinator = build({ OL_SCHEDULER_ENABLED: 'false' });

    await expect(coordinator.onModuleDestroy()).resolves.toBeUndefined();
  });

  describe('lease TTL resolution', () => {
    it('honours a valid configured TTL', async () => {
      const coordinator = build({ OL_SCHEDULER_LEASE_TTL_MS: '120000' });

      coordinator.onApplicationBootstrap();
      await settle();

      expect(syncLock.acquire).toHaveBeenCalledWith('singleton:scheduler', 120_000);
      await coordinator.onModuleDestroy();
    });

    it.each([
      ['5000', 15_000, 'below the floor'],
      ['9000000', 600_000, 'above the ceiling'],
    ])('clamps %s (%s) to %d', async (raw, expected) => {
      const coordinator = build({ OL_SCHEDULER_LEASE_TTL_MS: raw });

      coordinator.onApplicationBootstrap();
      await settle();

      expect(syncLock.acquire).toHaveBeenCalledWith('singleton:scheduler', expected);
      await coordinator.onModuleDestroy();
    });

    it.each(['nonsense', '0', '-1'])(
      'falls back to the default rather than honouring %p',
      async (raw) => {
        const coordinator = build({ OL_SCHEDULER_LEASE_TTL_MS: raw });

        coordinator.onApplicationBootstrap();
        await settle();

        expect(syncLock.acquire).toHaveBeenCalledWith('singleton:scheduler', 60_000);
        await coordinator.onModuleDestroy();
      }
    );
  });
});
