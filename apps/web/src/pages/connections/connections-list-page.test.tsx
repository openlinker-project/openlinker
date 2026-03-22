import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ConnectionsListPage } from './connections-list-page';

describe('ConnectionsListPage', () => {
  it('renders the page heading', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('heading', { name: 'Integration control center' })).toBeInTheDocument();
  });

  it('displays connections returned by the API', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn_1',
            name: 'Main PrestaShop Store',
            platformType: 'prestashop',
            status: 'active',
            config: { baseUrl: 'https://example.com' },
            credentialsRef: 'db:cred_1',
            adapterKey: 'prestashop.webservice.v1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByText('Main PrestaShop Store')).toBeInTheDocument();
  });
});
