/**
 * Analytics Trust Controller Unit Tests
 *
 * @module apps/api/src/analytics-trust/http
 */
import { AnalyticsTrustController } from './analytics-trust.controller';
import type { IAnalyticsTrustService, AnalyticsTrustSnapshot } from '@openlinker/core/analytics-trust';

describe('AnalyticsTrustController', () => {
  let analyticsTrustService: jest.Mocked<IAnalyticsTrustService>;
  let controller: AnalyticsTrustController;

  beforeEach(() => {
    analyticsTrustService = { getIngestionTrustSnapshot: jest.fn() };
    controller = new AnalyticsTrustController(analyticsTrustService);
  });

  it('maps the snapshot to the response DTO with ISO date strings', async () => {
    const snapshot: AnalyticsTrustSnapshot = {
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      worstStatus: 'fresh',
      connections: [
        {
          connectionId: 'conn-1',
          connectionName: 'My Allegro Store',
          platformType: 'allegro',
          connectionStatus: 'active',
          status: 'fresh',
          lastPollAt: new Date('2026-06-01T11:55:00.000Z'),
          lastOrderIngestedAt: new Date('2026-06-01T10:00:00.000Z'),
          connectionCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          earliestOrderDate: new Date('2026-02-10T00:00:00.000Z'),
          expectedIntervalMs: 300_000,
          staleAfterMs: 900_000,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.generatedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(result.worstStatus).toBe('fresh');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toEqual({
      connectionId: 'conn-1',
      connectionName: 'My Allegro Store',
      platformType: 'allegro',
      connectionStatus: 'active',
      status: 'fresh',
      lastPollAt: '2026-06-01T11:55:00.000Z',
      lastOrderIngestedAt: '2026-06-01T10:00:00.000Z',
      connectionCreatedAt: '2026-01-01T00:00:00.000Z',
      earliestOrderDate: '2026-02-10T00:00:00.000Z',
      expectedIntervalMs: 300_000,
      staleAfterMs: 900_000,
    });
  });

  it('maps a never-ingested connection with null lastPollAt and lastOrderIngestedAt', async () => {
    const snapshot: AnalyticsTrustSnapshot = {
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      worstStatus: 'never-ingested',
      connections: [
        {
          connectionId: 'conn-2',
          connectionName: 'New Erli Connection',
          platformType: 'erli',
          connectionStatus: 'active',
          status: 'never-ingested',
          lastPollAt: null,
          lastOrderIngestedAt: null,
          connectionCreatedAt: new Date('2026-05-30T00:00:00.000Z'),
          earliestOrderDate: null,
          expectedIntervalMs: null,
          staleAfterMs: null,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.connections[0].lastPollAt).toBeNull();
    expect(result.connections[0].lastOrderIngestedAt).toBeNull();
    expect(result.connections[0].status).toBe('never-ingested');
  });

  it('maps an unknown-status (degraded) connection', async () => {
    const snapshot: AnalyticsTrustSnapshot = {
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      worstStatus: 'unknown',
      connections: [
        {
          connectionId: 'conn-3',
          connectionName: 'Flaky Connection',
          platformType: 'allegro',
          connectionStatus: 'active',
          status: 'unknown',
          lastPollAt: null,
          lastOrderIngestedAt: null,
          connectionCreatedAt: new Date('2026-05-30T00:00:00.000Z'),
          earliestOrderDate: null,
          expectedIntervalMs: null,
          staleAfterMs: null,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.connections[0].status).toBe('unknown');
    expect(result.worstStatus).toBe('unknown');
  });

  it('maps a disconnected (needs_reauth) connection and passes connectionStatus through', async () => {
    const snapshot: AnalyticsTrustSnapshot = {
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      worstStatus: 'disconnected',
      connections: [
        {
          connectionId: 'conn-4',
          connectionName: 'Expired Allegro Token',
          platformType: 'allegro',
          connectionStatus: 'needs_reauth',
          status: 'disconnected',
          lastPollAt: new Date('2026-05-25T00:00:00.000Z'),
          lastOrderIngestedAt: new Date('2026-05-24T00:00:00.000Z'),
          connectionCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          earliestOrderDate: null,
          expectedIntervalMs: 300_000,
          staleAfterMs: 900_000,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.worstStatus).toBe('disconnected');
    expect(result.connections[0].connectionStatus).toBe('needs_reauth');
    expect(result.connections[0].status).toBe('disconnected');
  });

  it('returns an empty connections array when there are none', async () => {
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue({
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      worstStatus: 'fresh',
      connections: [],
    });

    const result = await controller.getTrust();

    expect(result.connections).toEqual([]);
    expect(result.worstStatus).toBe('fresh');
  });
});
