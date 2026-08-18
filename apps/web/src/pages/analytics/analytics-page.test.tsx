import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { AnalyticsPage } from './analytics-page';
import type { AnalyticsTrustSnapshot } from '../../features/analytics';

const ROUTE = '/analytics?from=2026-07-16&to=2026-08-14';

function snapshot(overrides: Partial<AnalyticsTrustSnapshot> = {}): AnalyticsTrustSnapshot {
  return {
    generatedAt: '2026-08-14T14:32:00.000Z',
    worstStatus: 'fresh',
    connections: [],
    ...overrides,
  };
}

describe('AnalyticsPage', () => {
  it('should show the loading state before the trust snapshot resolves', () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn(() => new Promise<AnalyticsTrustSnapshot>(() => {})),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(screen.getByText('Loading data coverage')).toBeInTheDocument();
  });

  it('should show the empty-instance state when there are no OrderSource connections', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(snapshot({ connections: [] })) },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(
      await screen.findByText('Connect a sales channel to see figures here'),
    ).toBeInTheDocument();
  });

  it('should show the "still arriving" card when every connection is never-ingested', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            worstStatus: 'never-ingested',
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Erli',
                platformType: 'erli',
                connectionStatus: 'active',
                status: 'never-ingested',
                lastPollAt: null,
                lastOrderIngestedAt: null,
                connectionCreatedAt: '2026-08-14T14:12:00.000Z',
                earliestOrderDate: null,
                expectedIntervalMs: null,
                staleAfterMs: null,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('First orders are still arriving')).toBeInTheDocument();
    expect(screen.getByText('Erli')).toBeInTheDocument();
  });

  it('should render the trust header for a populated, healthy instance', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Allegro — main',
                platformType: 'allegro',
                connectionStatus: 'active',
                status: 'fresh',
                lastPollAt: '2026-08-14T14:32:00.000Z',
                lastOrderIngestedAt: '2026-08-14T12:00:00.000Z',
                connectionCreatedAt: '2026-01-01T00:00:00.000Z',
                earliestOrderDate: '2026-01-05T00:00:00.000Z',
                expectedIntervalMs: 300000,
                staleAfterMs: 900000,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Allegro — main')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render the degradation banner for a stalled connection', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            worstStatus: 'stalled',
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Allegro — main',
                platformType: 'allegro',
                connectionStatus: 'active',
                status: 'stalled',
                lastPollAt: '2026-08-03T14:02:00.000Z',
                lastOrderIngestedAt: '2026-08-03T14:02:00.000Z',
                connectionCreatedAt: '2026-01-01T00:00:00.000Z',
                earliestOrderDate: '2026-01-05T00:00:00.000Z',
                expectedIntervalMs: 300000,
                staleAfterMs: 900000,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Unable to load data coverage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
