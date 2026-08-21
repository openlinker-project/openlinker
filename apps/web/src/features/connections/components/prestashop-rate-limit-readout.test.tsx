/**
 * PrestashopRateLimitReadout — Tests
 *
 * Branches per `.claude/rules/fe-pages.md` "Testing Priorities":
 * - loading: query in flight → muted "Checking…" copy
 * - error: query rejects → error copy + Retry button
 * - disabled: enabled: false → "no limit configured" copy
 * - enabled: renders the cap line, in-flight/queued line, and a manual Refresh button
 *
 * @module apps/web/src/features/connections/components
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { PrestashopRateLimitReadout } from './prestashop-rate-limit-readout';

describe('PrestashopRateLimitReadout', () => {
  it('shows a loading copy while the query is in flight', () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<PrestashopRateLimitReadout connectionId="conn_1" />, { apiClient });

    expect(screen.getByText('Checking rate-limit status…')).toBeInTheDocument();
  });

  it('shows an error state with a retry button when the query fails', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockRejectedValue(new Error('network error')),
      },
    });

    renderWithProviders(<PrestashopRateLimitReadout connectionId="conn_1" />, { apiClient });

    expect(await screen.findByText("Couldn't load rate-limit status.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the disabled copy when no cap is configured', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockResolvedValue({ enabled: false }),
      },
    });

    renderWithProviders(<PrestashopRateLimitReadout connectionId="conn_1" />, { apiClient });

    // Scoped to the outbound limiter (#2229). The previous blanket "this
    // connection is not rate-limited" was false for a connection whose adapter
    // paces its own resolve path below this mechanism.
    expect(
      await screen.findByText('No outbound limit configured — requests to this connection are not paced.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is not rate-limited/i)).not.toBeInTheDocument();
  });

  it('renders the cap + concurrency line and live counters plus a manual refresh button when enabled', async () => {
    const getRateLimitStatus = vi.fn().mockResolvedValue({
      enabled: true,
      requestsPerMinute: 60,
      maxConcurrent: 4,
      inFlight: 1,
      queued: 2,
      lastAcquiredAt: '2026-07-31T10:00:00.000Z',
    });
    const apiClient = createMockApiClient({
      connections: { getRateLimitStatus },
    });

    renderWithProviders(<PrestashopRateLimitReadout connectionId="conn_1" />, { apiClient });

    expect(await screen.findByText('Cap: 60/min, max 4 concurrent')).toBeInTheDocument();
    expect(screen.getByText('1 in flight, 2 queued')).toBeInTheDocument();

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    refreshButton.click();

    await waitFor(() => expect(getRateLimitStatus).toHaveBeenCalledTimes(2));
  });

  it('omits the concurrency clause when maxConcurrent is unset', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockResolvedValue({
          enabled: true,
          requestsPerMinute: 30,
          inFlight: 0,
          queued: 0,
          lastAcquiredAt: null,
        }),
      },
    });

    renderWithProviders(<PrestashopRateLimitReadout connectionId="conn_1" />, { apiClient });

    expect(await screen.findByText('Cap: 30/min')).toBeInTheDocument();
    expect(screen.getByText('0 in flight, 0 queued')).toBeInTheDocument();
  });
});
