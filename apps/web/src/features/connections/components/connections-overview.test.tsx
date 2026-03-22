import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ConnectionsOverview } from './connections-overview';

const sampleConnection = {
  id: 'conn_1',
  name: 'Main PrestaShop Store',
  platformType: 'prestashop',
  status: 'active',
  config: { baseUrl: 'https://example.com' },
  credentialsRef: 'db:cred_1',
  adapterKey: 'prestashop.webservice.v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ConnectionsOverview', () => {
  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<ConnectionsOverview />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<ConnectionsOverview />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'Unable to load connections' })).toBeInTheDocument();
  });

  it('shows empty state when no connections exist', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<ConnectionsOverview />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'No connections yet' })).toBeInTheDocument();
  });

  it('renders connection list with name and status', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });
    renderWithProviders(<ConnectionsOverview />, { apiClient });
    expect(await screen.findByText('Main PrestaShop Store')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });
});
