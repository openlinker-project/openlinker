import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionsListPage } from './connections-list-page';

describe('ConnectionsListPage', () => {
  afterEach(cleanup);

  it('renders the page heading', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });

  it('displays connections returned by the API', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByText(sampleConnection.name)).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'Unable to load connections' })).toBeInTheDocument();
  });

  it('shows empty state when no connections exist', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'No connections found' })).toBeInTheDocument();
  });

  it('renders platform and status filter dropdowns', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('combobox', { name: 'Filter by platform' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
  });
});
