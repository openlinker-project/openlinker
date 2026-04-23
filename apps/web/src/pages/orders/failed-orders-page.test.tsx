import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { FailedOrdersPage } from './failed-orders-page';
import type { PaginatedOrders, OrderRecord } from '../../features/orders/api/orders.types';

function makeOrderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_aabbccdd1122334455',
    customerId: null,
    sourceConnectionId: 'conn-1111-2222-3333-444444444444',
    sourceEventId: 'evt-001',
    orderSnapshot: {
      externalOrderId: 'EXT-123',
      items: [{ id: 'item-1', productRef: { type: 'offer', externalId: 'offer-a' }, quantity: 1, price: 9.99 }],
    },
    syncStatus: [],
    recordStatus: 'awaiting_mapping',
    createdAt: '2026-04-10T08:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    ...overrides,
  };
}

const sampleData: PaginatedOrders = {
  items: [makeOrderRecord()],
  total: 1,
  limit: 25,
  offset: 0,
};

describe('FailedOrdersPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      orders: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(screen.getByText('Loading orders')).toBeInTheDocument();
  });

  it('should fetch orders with recordStatus=awaiting_mapping filter', async () => {
    const list = vi.fn().mockResolvedValue(sampleData);
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    await screen.findByText(/ol_order_aabbccd/);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ recordStatus: 'awaiting_mapping' }),
      expect.any(Object),
    );
  });

  it('should show awaiting-mapping orders table when data loads', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(sampleData) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText(/ol_order_aabbccd/)).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load orders')).toBeInTheDocument();
  });

  it('should show empty state when no orders awaiting mapping', async () => {
    const mockApi = createMockApiClient({
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText('No orders awaiting mapping')).toBeInTheDocument();
  });
});
