import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { OrdersListPage } from './orders-list-page';
import type { PaginatedOrders } from '../../features/orders/api/orders.types';

const sampleOrders: PaginatedOrders = {
  items: [
    {
      internalOrderId: 'ol_order_abc123',
      customerId: 'ol_customer_xyz',
      sourceConnectionId: 'conn_allegro_1',
      sourceEventId: null,
      orderSnapshot: {},
      syncStatus: [{ destinationConnectionId: 'conn_ps_1', status: 'synced', syncedAt: '2026-01-15T10:00:00.000Z', externalOrderId: '42', externalOrderNumber: null, error: null }],
      recordStatus: 'ready',
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('OrdersListPage', () => {
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status', { name: 'Loading table data' })).toBeInTheDocument();
  });

  it('should show orders table when data loads', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(sampleOrders) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('ol_order_abc123')).toBeInTheDocument();
    expect(screen.getByText('conn_allegro_1')).toBeInTheDocument();
    expect(screen.getByText('ol_customer_xyz')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load orders')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show empty state when no orders exist', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No orders found')).toBeInTheDocument();
  });
});
