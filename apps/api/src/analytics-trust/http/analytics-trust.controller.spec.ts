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
      connections: [
        {
          connectionId: 'conn-1',
          connectionName: 'My Allegro Store',
          platformType: 'allegro',
          status: 'fresh',
          lastSuccessfulIngestionAt: new Date('2026-06-01T11:55:00.000Z'),
          coverageStartAt: new Date('2026-01-01T00:00:00.000Z'),
          expectedIntervalMs: 300_000,
          staleAfterMs: 900_000,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.generatedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toEqual({
      connectionId: 'conn-1',
      connectionName: 'My Allegro Store',
      platformType: 'allegro',
      status: 'fresh',
      lastSuccessfulIngestionAt: '2026-06-01T11:55:00.000Z',
      coverageStartAt: '2026-01-01T00:00:00.000Z',
      expectedIntervalMs: 300_000,
      staleAfterMs: 900_000,
    });
  });

  it('maps a never-ingested connection with null lastSuccessfulIngestionAt', async () => {
    const snapshot: AnalyticsTrustSnapshot = {
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      connections: [
        {
          connectionId: 'conn-2',
          connectionName: 'New Erli Connection',
          platformType: 'erli',
          status: 'never-ingested',
          lastSuccessfulIngestionAt: null,
          coverageStartAt: new Date('2026-05-30T00:00:00.000Z'),
          expectedIntervalMs: null,
          staleAfterMs: null,
        },
      ],
    };
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue(snapshot);

    const result = await controller.getTrust();

    expect(result.connections[0].lastSuccessfulIngestionAt).toBeNull();
    expect(result.connections[0].status).toBe('never-ingested');
  });

  it('returns an empty connections array when there are none', async () => {
    analyticsTrustService.getIngestionTrustSnapshot.mockResolvedValue({
      generatedAt: new Date('2026-06-01T12:00:00.000Z'),
      connections: [],
    });

    const result = await controller.getTrust();

    expect(result.connections).toEqual([]);
  });
});
