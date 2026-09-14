import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ConnectionDiagnosticsPanel } from './ConnectionDiagnosticsPanel';

const diagnostics = {
  connectionId: 'conn_1',
  connectionName: 'Test',
  connectionStatus: 'active',
  lastSucceededAt: null,
  lastFailedAt: null,
  recentErrors: [],
  recentJobs: [],
};

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
          ...diagnostics,
          lastSucceededAt: '2026-01-15T10:00:00.000Z',
          lastFailedAt: null,
        }),
      },
    });
    renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

    expect(await screen.findByText('Last succeeded')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument(); // lastFailedAt is null
  });

  // #3179 — a null timestamp means two different things, and only one of them
  // is a claim about the operator's data.
  describe('unreadable sources', () => {
    it('renders "Never" only when every source was actually read', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getDiagnostics: vi
            .fn()
            .mockResolvedValue({ ...diagnostics, unreadableSources: [] }),
        },
      });
      renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

      expect(await screen.findByText('Last succeeded')).toBeInTheDocument();
      expect(screen.getAllByText('Never')).toHaveLength(2);
      expect(screen.queryByText(/could not be checked/i)).not.toBeInTheDocument();
    });

    it('renders "Unknown" instead of "Never" while a source could not be read', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getDiagnostics: vi.fn().mockResolvedValue({
            ...diagnostics,
            unreadableSources: ['fiscalRegistrations'],
          }),
        },
      });
      renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

      expect(await screen.findByText('Last succeeded')).toBeInTheDocument();
      expect(screen.getAllByText('Unknown')).toHaveLength(2);
      expect(screen.queryByText('Never')).not.toBeInTheDocument();
    });

    it('names every unreadable source in visible text, not a title attribute', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getDiagnostics: vi.fn().mockResolvedValue({
            ...diagnostics,
            unreadableSources: ['fiscalRegistrations', 'invoices'],
          }),
        },
      });
      renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

      expect(await screen.findByText('Some activity could not be checked')).toBeInTheDocument();
      expect(screen.getByText(/fiscal receipts and invoices/)).toBeInTheDocument();
    });

    it('keeps a real timestamp visible while warning the answer may be incomplete', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getDiagnostics: vi.fn().mockResolvedValue({
            ...diagnostics,
            lastSucceededAt: '2026-01-15T10:00:00.000Z',
            unreadableSources: ['invoices'],
          }),
        },
      });
      renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

      expect(await screen.findByText('Some activity could not be checked')).toBeInTheDocument();
      // The observation is real, so it stays; only the null half reads Unknown.
      expect(screen.getAllByText('Unknown')).toHaveLength(1);
    });

    it('treats an absent unreadableSources (pre-#3179 API) as nothing to report', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getDiagnostics: vi.fn().mockResolvedValue(diagnostics),
        },
      });
      renderWithProviders(<ConnectionDiagnosticsPanel connectionId="conn_1" />, { apiClient });

      expect(await screen.findByText('Last succeeded')).toBeInTheDocument();
      expect(screen.getAllByText('Never')).toHaveLength(2);
      expect(screen.queryByText(/could not be checked/i)).not.toBeInTheDocument();
    });
  });
});
