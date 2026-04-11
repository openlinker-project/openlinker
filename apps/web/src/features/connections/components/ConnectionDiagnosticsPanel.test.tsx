import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ConnectionDiagnosticsPanel } from './ConnectionDiagnosticsPanel';

describe('ConnectionDiagnosticsPanel', () => {
  afterEach(cleanup);

  it('shows loading state while fetching diagnostics', () => {
    const apiClient = createMockApiClient({
      connections: { getDiagnostics: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

    expect(screen.getByRole('heading', { name: 'Loading diagnostics' })).toBeInTheDocument();
  });

  it('shows error state when diagnostics fetch fails', async () => {
    const apiClient = createMockApiClient({
      connections: { getDiagnostics: vi.fn().mockRejectedValue(new Error('Failed')) },
    });
    renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

    expect(await screen.findByRole('heading', { name: 'Unable to load diagnostics' })).toBeInTheDocument();
  });

  it('displays diagnostics data when loaded', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getDiagnostics: vi.fn().mockResolvedValue({
          connectionId: 'conn_1',
          connectionName: 'Test',
          connectionStatus: 'active',
          lastSucceededAt: '2026-01-15T10:00:00.000Z',
          lastFailedAt: null,
          recentErrors: [],
          recentJobs: [],
        }),
      },
    });
    renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

    expect(await screen.findByText('Last succeeded')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument(); // lastFailedAt is null
  });
});
