import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { CustomersListPage } from './customers-list-page';
import type { PaginatedCustomers } from '../../features/customers/api/customers.types';

const sampleCustomers: PaginatedCustomers = {
  items: [
    {
      internalCustomerId: 'ol_customer_abc123',
      emailHash: 'abc123hash',
      normalizedEmail: 'buyer@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      lastSeenAt: '2026-03-01T10:00:00.000Z',
      lastSourceConnectionId: 'conn_allegro_1',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    },
    {
      internalCustomerId: 'ol_customer_def456',
      emailHash: 'def456hash',
      normalizedEmail: null,
      firstName: null,
      lastName: null,
      lastSeenAt: '2026-02-15T12:00:00.000Z',
      lastSourceConnectionId: null,
      createdAt: '2026-02-15T12:00:00.000Z',
      updatedAt: '2026-02-15T12:00:00.000Z',
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

describe('CustomersListPage', () => {
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      customers: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show customers table when data loads', async () => {
    const mockApi = createMockApiClient({
      customers: {
        list: vi.fn().mockResolvedValue(sampleCustomers),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('abc123hash')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('conn_allegro_1')).toBeInTheDocument();
    expect(screen.getByText('def456hash')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      customers: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load customers')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show empty state when no customers exist', async () => {
    const mockApi = createMockApiClient({
      customers: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No customers found')).toBeInTheDocument();
  });

  it('should show empty state with filter message when filters are active', async () => {
    const mockApi = createMockApiClient({
      customers: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<CustomersListPage />, {
      apiClient: mockApi,
      route: '/customers?search=unknown',
    });

    expect(await screen.findByText('No customer projections match the current filters.')).toBeInTheDocument();
  });
});
