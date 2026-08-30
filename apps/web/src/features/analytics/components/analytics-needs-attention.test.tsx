import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { AnalyticsNeedsAttention } from './analytics-needs-attention';
import type { NeedsAttentionSummary } from '../api/needs-attention.types';
import type { Connection } from '../../connections';

function summary(overrides: Partial<NeedsAttentionSummary> = {}): NeedsAttentionSummary {
  return {
    coverageGaps: [],
    coverageGapsTotalCount: 0,
    stockAtRisk: [],
    stockAtRiskTotalCount: 0,
    failedSyncValue: { count: 0, totalValue: 0, mixedCurrency: false, oldestFailedAt: null },
    ...overrides,
  };
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'Allegro',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    ...overrides,
  } as Connection;
}

describe('AnalyticsNeedsAttention', () => {
  it('should show the loading state before the summary resolves', () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn(() => new Promise<NeedsAttentionSummary>(() => {})),
      },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(screen.getByText('Checking for open items')).toBeInTheDocument();
  });

  it('should show an error state with retry when the summary fetch fails', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn().mockRejectedValue(new Error('boom')),
      },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('Unable to check for open items')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('should render the all-clear line when every category is resolved', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getNeedsAttention: vi.fn().mockResolvedValue(summary()) },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
    expect(screen.getByText('3 checks · coverage, stock, destination syncs')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('should show a "checked" timestamp once the summary has loaded', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getNeedsAttention: vi.fn().mockResolvedValue(summary()) },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
    expect(screen.getByText('checked', { exact: false })).toBeInTheDocument();
  });

  it('should render only the open categories, not the resolved one', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn().mockResolvedValue(
          summary({
            coverageGaps: [
              {
                variantId: 'v1',
                productId: 'p1',
                listedOnConnectionIds: ['conn-2'],
                missingFromConnectionIds: ['conn-1'],
              },
            ],
            coverageGapsTotalCount: 1,
          }),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([connection()]) },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('1 variant missing from Allegro')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText(/at or below/)).not.toBeInTheDocument();
    expect(screen.queryByText(/never reached a destination/)).not.toBeInTheDocument();
  });

  it('should render all three categories with the correct badge tones and links', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn().mockResolvedValue(
          summary({
            coverageGaps: [
              {
                variantId: 'v1',
                productId: 'p1',
                listedOnConnectionIds: ['conn-2'],
                missingFromConnectionIds: ['conn-1'],
              },
            ],
            coverageGapsTotalCount: 1,
            stockAtRisk: [
              { variantId: 'v2', productId: 'p2', connectionId: 'conn-1', masterStock: 0, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
            ],
            stockAtRiskTotalCount: 1,
            failedSyncValue: { count: 2, totalValue: 100, mixedCurrency: false, oldestFailedAt: null },
          }),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([connection()]) },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('1 variant missing from Allegro')).toBeInTheDocument();
    expect(screen.getByText('1 variant publishing no stock on Allegro')).toBeInTheDocument();
    expect(screen.getByText('2 orders never reached a destination')).toBeInTheDocument();

    expect(screen.getAllByText('Action')).toHaveLength(2);
    expect(screen.getByText('Stuck')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Publish now' })).toHaveAttribute(
      'href',
      '/listings/bulk-create/wizard?productIds=p1&variantIds=v1&connectionId=conn-1',
    );
    expect(screen.getByRole('link', { name: 'Review stock' })).toHaveAttribute('href', '/products/p2');
    expect(screen.getByRole('link', { name: 'Review orders' })).toHaveAttribute(
      'href',
      '/orders?health=needs_attention',
    );
  });

  it('should NOT pin a connectionId in the Publish now link for a partial, uniform-connection sample (#2120 re-review, IMPORTANT)', async () => {
    // 1-of-2 sample, all missing from conn-1 only — but the headline
    // correctly declines to name a channel because the sample doesn't cover
    // the total, so the deep link must not name one either.
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn().mockResolvedValue(
          summary({
            coverageGaps: [
              {
                variantId: 'v1',
                productId: 'p1',
                listedOnConnectionIds: ['conn-2'],
                missingFromConnectionIds: ['conn-1'],
              },
            ],
            coverageGapsTotalCount: 2,
          }),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([connection()]) },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(await screen.findByText('2 variants with a listing gap on at least one channel')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Publish now' });
    expect(link).toHaveAttribute('href', '/listings/bulk-create/wizard?productIds=p1&variantIds=v1');
    expect(link.getAttribute('href')).not.toContain('connectionId');
  });

  it('should fall back to a connection-agnostic headline for an ambiguous coverage gap', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getNeedsAttention: vi.fn().mockResolvedValue(
          summary({
            coverageGaps: [
              {
                variantId: 'v1',
                productId: 'p1',
                listedOnConnectionIds: [],
                missingFromConnectionIds: ['conn-1'],
              },
              {
                variantId: 'v2',
                productId: 'p1',
                listedOnConnectionIds: [],
                missingFromConnectionIds: ['conn-2'],
              },
            ],
            coverageGapsTotalCount: 2,
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsNeedsAttention />, { apiClient });

    expect(
      await screen.findByText('2 variants with a listing gap on at least one channel'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Publish now' })).toHaveAttribute(
      'href',
      '/listings/bulk-create/wizard?productIds=p1&variantIds=v1%2Cv2',
    );
  });
});
