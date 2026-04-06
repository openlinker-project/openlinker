import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  it('renders the operations overview heading', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
  });

  it('shows real connection count from API', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'Store A', status: 'active', platformType: 'prestashop', config: {}, credentialsRef: 'ref', createdAt: '', updatedAt: '' },
          { id: 'c2', name: 'Store B', status: 'error', platformType: 'allegro', config: {}, credentialsRef: 'ref', createdAt: '', updatedAt: '' },
        ]),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Store A')).toBeInTheDocument();
    expect(screen.getByText('Store B')).toBeInTheDocument();
  });

  it('shows system health services from API', async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    expect(await within(container).findByText('PostgreSQL')).toBeInTheDocument();
    expect(within(container).getByText('Redis')).toBeInTheDocument();
    expect(within(container).getByText('PrestaShop')).toBeInTheDocument();
  });

  it('shows error message when a service is degraded', async () => {
    const apiClient = createMockApiClient({
      health: {
        getDevStackHealth: vi.fn().mockResolvedValue({
          status: 'degraded',
          services: {
            postgres: { status: 'ok' },
            redis: { status: 'ok' },
            prestashop: { status: 'error', message: 'Connection refused' },
          },
          timestamp: '2026-04-06T00:00:00.000Z',
        }),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('Connection refused')).toBeInTheDocument();
  });

  it('shows loading state while connections are fetching', () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when health check fails', async () => {
    const apiClient = createMockApiClient({
      health: {
        getDevStackHealth: vi.fn().mockRejectedValue(new Error('Health endpoint unreachable')),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByRole('heading', { name: 'Health check failed' })).toBeInTheDocument();
  });

  it('shows placeholder panels for sync jobs sections', () => {
    renderWithProviders(<DashboardPage />);

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toContain('Recent sync events');
    expect(headings).toContain('Retry and incident queue');
  });
});
