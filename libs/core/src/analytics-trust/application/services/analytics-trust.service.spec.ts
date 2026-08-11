/**
 * Analytics Trust Service Unit Tests
 *
 * @module libs/core/src/analytics-trust/application/services
 */
import { AnalyticsTrustService } from './analytics-trust.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISyncJobsService, SchedulerTaskRegistryService } from '@openlinker/core/sync';
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

describe('AnalyticsTrustService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let syncJobsService: jest.Mocked<Pick<ISyncJobsService, 'findLastSucceededJob'>>;
  let schedulerTaskRegistry: jest.Mocked<Pick<SchedulerTaskRegistryService, 'getAll'>>;
  let service: AnalyticsTrustService;

  const now = new Date('2026-06-01T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    integrationsService = { listCapabilityAdapters: jest.fn() };
    syncJobsService = { findLastSucceededJob: jest.fn() };
    schedulerTaskRegistry = { getAll: jest.fn() };

    service = new AnalyticsTrustService(
      integrationsService as unknown as IIntegrationsService,
      syncJobsService as unknown as ISyncJobsService,
      schedulerTaskRegistry as unknown as SchedulerTaskRegistryService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty connections array when no OrderSource connections exist', async () => {
    integrationsService.listCapabilityAdapters.mockResolvedValue([]);
    schedulerTaskRegistry.getAll.mockReturnValue([]);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toEqual([]);
    expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
      capability: 'OrderSource',
      lazy: true,
    });
  });

  it('returns never-ingested when no succeeded job exists for a connection', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([
      {
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({}),
        generateIdempotencyKey: (): string => 'key',
      },
    ]);
    syncJobsService.findLastSucceededJob.mockResolvedValue(null);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      connectionId: 'conn-1',
      status: 'never-ingested',
      lastSuccessfulIngestionAt: null,
    });
  });

  it('returns fresh when the last succeeded job is within the platform poll threshold', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([
      {
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({}),
        generateIdempotencyKey: (): string => 'key',
      },
    ]);
    // 5-min cadence * 3 threshold = 15 min; last success 2 min ago is well within it.
    const recentSuccess = new Date(now.getTime() - 2 * 60 * 1000);
    syncJobsService.findLastSucceededJob.mockResolvedValue({
      id: 'job-1',
      updatedAt: recentSuccess,
    } as SyncJobEntity);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      status: 'fresh',
      lastSuccessfulIngestionAt: recentSuccess,
    });
  });

  it('returns stalled when the last succeeded job is older than 3x the poll interval', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([
      {
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({}),
        generateIdempotencyKey: (): string => 'key',
      },
    ]);
    // 5-min cadence * 3 threshold = 15 min; last success 1 hour ago is well beyond it.
    const staleSuccess = new Date(now.getTime() - 60 * 60 * 1000);
    syncJobsService.findLastSucceededJob.mockResolvedValue({
      id: 'job-1',
      updatedAt: staleSuccess,
    } as SyncJobEntity);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({ status: 'stalled' });
  });

  it('marks expectedIntervalMs and staleAfterMs null when no scheduler task matches the platform', async () => {
    const connection = makeConnection({ platformType: 'unknown-platform' });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([
      {
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({}),
        generateIdempotencyKey: (): string => 'key',
      },
    ]);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0]).toMatchObject({
      expectedIntervalMs: null,
      staleAfterMs: null,
      status: 'never-ingested',
    });
    expect(syncJobsService.findLastSucceededJob).not.toHaveBeenCalled();
  });

  it('degrades a single connection to never-ingested and does not throw when building its entry fails', async () => {
    const connection = makeConnection();
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([
      {
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({}),
        generateIdempotencyKey: (): string => 'key',
      },
    ]);
    syncJobsService.findLastSucceededJob.mockRejectedValue(new Error('boom'));

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      connectionId: 'conn-1',
      status: 'never-ingested',
      lastSuccessfulIngestionAt: null,
    });
  });

  it('reports coverageStartAt as the connection createdAt', async () => {
    const createdAt = new Date('2026-05-20T00:00:00.000Z');
    const connection = makeConnection({ createdAt });
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      { connectionId: connection.id, connection, adapter: {}, metadata: {} as never },
    ]);
    schedulerTaskRegistry.getAll.mockReturnValue([]);

    const result = await service.getIngestionTrustSnapshot();

    expect(result.connections[0].coverageStartAt).toEqual(createdAt);
  });
});
