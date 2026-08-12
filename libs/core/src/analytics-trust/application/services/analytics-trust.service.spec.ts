/**
 * Analytics Trust Service Unit Tests
 *
 * @module libs/core/src/analytics-trust/application/services
 */
import { AnalyticsTrustService } from './analytics-trust.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISyncJobsService, SchedulerTaskConfig } from '@openlinker/core/sync';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SyncJobEntity } from '@openlinker/core/sync';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'allegro',
    name: 'My Allegro Store',
    status: 'active',
    config: {},
    credentialsRef: 'ref-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    adapterKey: undefined,
    enabledCapabilities: ['OrderSource'],
    ...overrides,
  } as Connection;
}

function makeTask(overrides: Partial<SchedulerTaskConfig> = {}): SchedulerTaskConfig {
  return {
    taskId: 'allegro-orders-poll',
    platformType: 'allegro',
    jobType: 'marketplace.orders.poll',
    cronExpression: '*/5 * * * *',
    generatePayload: (): Record<string, unknown> => ({}),
    generateIdempotencyKey: (): string => 'key',
    ...overrides,
  };
}

describe('AnalyticsTrustService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let syncJobsService: jest.Mocked<Pick<ISyncJobsService, 'findLastSucceededJob' | 'findEnabledPollTask'>>;
  let service: AnalyticsTrustService;

  const now = new Date('2026-06-01T12:00:00.000Z');

  function mockJobsFor(connectionId: string, pollJob: SyncJobEntity | null, orderSyncJob: SyncJobEntity | null): void {
    syncJobsService.findLastSucceededJob.mockImplementation((id, jobType) => {
      if (id !== connectionId) return Promise.resolve(null);
      return Promise.resolve(jobType === 'marketplace.orders.poll' ? pollJob : orderSyncJob);
    });
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    integrationsService = { listCapabilityAdapters: jest.fn() };
    syncJobsService = {
      findLastSucceededJob: jest.fn().mockResolvedValue(null),
      findEnabledPollTask: jest.fn().mockReturnValue(null),
    };

    service = new AnalyticsTrustService(
      integrationsService as unknown as IIntegrationsService,
      syncJobsService as unknown as ISyncJobsService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty connections array when no OrderSource connections exist', async () => {
    integrationsService.listCapabilityAdapters.mockResolvedValue([]);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toEqual([]);
    expect(result.worstStatus).toBe('fresh');
    expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
      capability: 'OrderSource',
      lazy: true,
    });
  });

  it('rolls up worstStatus across multiple connections', async () => {
    const freshConnection = makeConnection({ id: 'conn-fresh' });
    const stalledConnection = makeConnection({ id: 'conn-stalled', platformType: 'allegro' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: freshConnection.id, connection: freshConnection, adapter: {}, metadata: {} as never },
      { connectionId: stalledConnection.id, connection: stalledConnection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    syncJobsService.findLastSucceededJob.mockImplementation((id, jobType) => {
      if (jobType !== 'marketplace.orders.poll') return Promise.resolve(null);
      const pollAt =
        id === freshConnection.id
          ? new Date(now.getTime() - 2 * 60 * 1000)
          : new Date(now.getTime() - 60 * 60 * 1000);
      return Promise.resolve({ id: `job-${id}`, updatedAt: pollAt } as SyncJobEntity);
    });

    const result = await service.getIngestionTrustSnapshot();

    expect(result.worstStatus).toBe('stalled');
  });

  it('returns never-ingested when no succeeded poll job exists for a connection', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    mockJobsFor(connection.id, null, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      connectionId: 'conn-1',
      status: 'never-ingested',
      lastPollAt: null,
      lastOrderIngestedAt: null,
    });
  });

  it('returns fresh when the last succeeded poll is within the platform poll threshold', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    // 5-min cadence * 3 = 15 min, floored up to 30 min (see the dedicated
    // floor test below) — either way, 2 min ago is well within threshold.
    const recentPoll = new Date(now.getTime() - 2 * 60 * 1000);
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: recentPoll } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      status: 'fresh',
      lastPollAt: recentPoll,
    });
  });

  it('returns stalled when the last succeeded poll is older than the floored threshold', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    // 5-min cadence * 3 = 15 min, floored up to 30 min; 1 hour ago is well
    // beyond even the floor.
    const stalePoll = new Date(now.getTime() - 60 * 60 * 1000);
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: stalePoll } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({ status: 'stalled' });
  });

  it('applies the 30-minute floor rather than a tighter multiplier result for a slow backstop poll', async () => {
    const connection = makeConnection({ platformType: 'prestashop' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    // 10-min cadence * 3 = 30 min exactly the floor; 25 min ago is inside
    // the floor but would have been "stalled" under a naive 15-min reading.
    syncJobsService.findEnabledPollTask.mockReturnValue(
      makeTask({ platformType: 'prestashop', cronExpression: '*/10 * * * *' })
    );
    const twentyFiveMinAgo = new Date(now.getTime() - 25 * 60 * 1000);
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: twentyFiveMinAgo } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({ status: 'fresh', staleAfterMs: 30 * 60 * 1000 });
  });

  it('marks expectedIntervalMs and staleAfterMs null when no scheduler task matches the connection platform', async () => {
    const connection = makeConnection({ platformType: 'unknown-platform' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(null);
    mockJobsFor(connection.id, null, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      expectedIntervalMs: null,
      staleAfterMs: null,
      status: 'never-ingested',
    });
  });

  it('still reports a healthy poll history when the platform task is registered but disabled (finding 2)', async () => {
    const connection = makeConnection({ platformType: 'woocommerce' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    // findEnabledPollTask already filters out a disabled task — the service
    // must treat that exactly like "no task registered", not like "cadence
    // is 0". A recent poll must still read fresh with a null threshold.
    syncJobsService.findEnabledPollTask.mockReturnValue(null);
    const recentPoll = new Date(now.getTime() - 2 * 60 * 1000);
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: recentPoll } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      status: 'fresh',
      lastPollAt: recentPoll,
      expectedIntervalMs: null,
      staleAfterMs: null,
    });
  });

  it('reports a succeeded poll job even when no scheduler task is registered for the platform (finding 1)', async () => {
    const connection = makeConnection({ platformType: 'prestashop' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    // No matching task at all — e.g. the platform's poll is env-gated off
    // because the connection ingests via webhooks. The lookup must not be
    // skipped just because there's no task to derive a threshold from.
    syncJobsService.findEnabledPollTask.mockReturnValue(null);
    const recentPoll = new Date(now.getTime() - 2 * 60 * 1000);
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: recentPoll } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(syncJobsService.findLastSucceededJob).toHaveBeenCalledWith(
      connection.id,
      'marketplace.orders.poll'
    );
    expect(result.connections[0]).toMatchObject({ status: 'fresh', lastPollAt: recentPoll });
  });

  it('reports lastOrderIngestedAt independently of the poll threshold (data recency vs. pipe liveness)', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    const recentPoll = new Date(now.getTime() - 2 * 60 * 1000);
    // No order has ever synced, but the poll pipe is alive — status must
    // still be driven by the poll, not by the absent order-sync signal.
    mockJobsFor(connection.id, { id: 'job-1', updatedAt: recentPoll } as SyncJobEntity, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      status: 'fresh',
      lastPollAt: recentPoll,
      lastOrderIngestedAt: null,
    });
  });

  it('degrades a single connection to unknown and does not throw when building its entry fails', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(makeTask());
    syncJobsService.findLastSucceededJob.mockRejectedValue(new Error('boom'));

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      connectionId: 'conn-1',
      status: 'unknown',
      lastPollAt: null,
      lastOrderIngestedAt: null,
    });
  });

  it('reports connectionCreatedAt as the connection createdAt', async () => {
    const createdAt = new Date('2026-05-20T00:00:00.000Z');
    const connection = makeConnection({ createdAt });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    syncJobsService.findEnabledPollTask.mockReturnValue(null);
    mockJobsFor(connection.id, null, null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0].connectionCreatedAt).toEqual(createdAt);
  });
});
