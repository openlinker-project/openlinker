import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionsListPage } from './connections-list-page';

describe('ConnectionsListPage', () => {
  it('renders the page heading', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('heading', { name: 'Integration control center' })).toBeInTheDocument();
  });

  it('displays connections returned by the API', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByText(sampleConnection.name)).toBeInTheDocument();
  });
});
